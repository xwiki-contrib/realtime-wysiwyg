/*
 * Copyright 2014 XWiki SAS
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
define([
    'RTWysiwyg_ErrorBox',
    'RTWysiwyg_WebHome_realtime_cleartext',
    'RTWysiwyg_WebHome_hyperjson',
    'RTWysiwyg_WebHome_hyperscript',
    'RTWysiwyg_WebHome_toolbar',
    'RTWysiwyg_WebHome_cursor',
    'RTWysiwyg_WebHome_json_ot',
    'RTWysiwyg_WebHome_diffDOM',
    'jquery'
], function (ErrorBox, Realtime, /*Convert,*/Hyperjson, Hyperscript, Toolbar, Cursor, JsonOT, DiffDom) {
    // be very careful, dumping jquery as '$' into the global scope will break
    // prototype js bindings
    var $ = window.jQuery;
    var DiffDom = window.diffDOM;

    /** Key in the localStore which indicates realtime activity should be disallowed. */
    var LOCALSTORAGE_DISALLOW = 'rtwysiwyg-disallow';

    var module = {};

    var uid = function () {
        return 'rtwiki-uid-' + String(Math.random()).substring(2);
    };

    var runningRealtime = false;

    var main = module.main = function (WebsocketURL, userName, Messages, channel, DEMO_MODE, language) {
        var realtimeAllowed = function (bool) {
            if (typeof bool === 'undefined') {
                var disallow = localStorage.getItem(LOCALSTORAGE_DISALLOW);
                if (disallow) {
                    return false;
                } else {
                    return true;
                }
            } else {
                localStorage.setItem(LOCALSTORAGE_DISALLOW, bool? '' : 1);
                return bool;
            }
        };

        var allowRealtimeCbId = uid();

        var checked = (realtimeAllowed()? 'checked' : '');

        var disallowButtonHTML = ('<div class="rtwiki-allow-outerdiv">' +
            '<label class="rtwiki-allow-label" for="' + allowRealtimeCbId + '">' +
                '<input type="checkbox" class="rtwiki-allow" id="' + allowRealtimeCbId + '" '+
                    checked + ' />' + ' ' + Messages.allowRealtime + 
            '</label>' +
        '</div>');

        var $editButtons = $('.buttons');

        console.log("Creating realtime toggle");
        $editButtons.append(disallowButtonHTML);

        var $disallowButton = $('#' + allowRealtimeCbId);

        var disallowClick = function () {
            var checked = $disallowButton[0].checked;
            console.log("Value of 'allow realtime collaboration' is %s", checked);
            if (checked || DEMO_MODE) {
                realtimeAllowed(true);

                window.location.reload();
            } else {
                realtimeAllowed(false);
                module.abortRealtime();
            }
        };

        $disallowButton.on('change', disallowClick);

        if (!realtimeAllowed()) {
            console.log("Realtime is disallowed. Quitting");
            return;
        }

        var whenReady = function (editor, iframe) {
            var inner = iframe.contentWindow.body;
            var $textarea = $('<textarea>');

            var setEditable = function (bool) {
                inner.setAttribute('contenteditable', bool);
            };

            var initializing = true;
            // disable CKEditor until the realtime is ready
            setEditable(false);

            var config = {
                textarea: $textarea[0],
                websocketURL: WebsocketURL,
                userName: userName,
                channel: channel,
                transformFunction: JsonOT.validate
            };

            var cursor = window.cursor = Cursor(inner);

            var diffOptions = {
                preDiffApply: function (info) {
                    if (!cursor.exists()) { return; }
                    var frame = info.frame = cursor.inNode(info.node);
                    if (!frame) { return; }
                    if (typeof info.diff.oldValue === 'string' &&
                        typeof info.diff.newValue === 'string') {
                        var pushes = cursor.pushDelta(info.diff.oldValue,
                            info.diff.newValue);
                        if (frame & 1) {
                            if (pushes.commonStart < cursor.Range.start.offset) {
                                cursor.Range.start.offset += pushes.delta;
                            }
                        }
                        if (frame & 2) {
                            if (pushes.commonStart < cursor.Range.end.offset) {
                                cursor.Range.end.offset += pushes.delta;
                            }
                        }
                    }
                },
                postDiffApply: function (info) {
                    if (info.frame) {
                        if (info.node) {
                            if (info.frame & 1) { cursor.fixStart(info.node); }
                            if (info.frame & 2) { cursor.fixEnd(info.node); }
                        } else { console.log("info.node did not exist"); }

                        var sel = cursor.makeSelection();
                        var range = cursor.makeRange();

                        cursor.fixSelection(sel, range);
                    }
                }
            };

            var applyHjson = function (parsed) {
                if (typeof (parsed) !== 'object') {
                    // we won't be able to patch it in...
                    console.log("[applyHjson] supplied argument was not valid hyperjson");
                    return;
                }

                var userDocStateDom = Hyperjson.callOn(parsed, Hyperscript);
                userDocStateDom.setAttribute("contenteditable", true);
                var DD = new DiffDom(diffOptions);
                var patch = DD.diff(inner, userDocStateDom);
                DD.apply(inner, patch);
            };

            var onRemote = config.onRemote = function (info) {
                if (initializing) { return; }
                cursor.update();
                var parsed = JSON.parse(info.realtime.getUserDoc());
                applyHjson(parsed);
            };

            var onAbort = config.onAbort = function (info) {
                var realtime = info.socket.realtime;
                realtime.toolbar.failed();
                toolbar.destroy();
            };

            var onReady = config.onReady = function (info) {
                console.log("Realtime is ready!");
                initializing = false;
                setEditable(true);

                var parsed;
                try {
                    parsed = JSON.parse(info.realtime.getUserDoc());
                } catch (err) {
                    // probably not an error that matters.
                    //console.error(err);

                    //$textarea.val(module.realtime.realtime.getUserDoc());
                    console.log("Readying new document");
                    onRemote(info);

                    // not valid json, it's probably a new document
                    if (module.updateTransport) {
                        // FIXME this is a really unfortunate name.
                        //module.updateTransport();
                    }

                    return;
                }

                applyHjson(parsed);
            };

            var onUserListChange = config.onUserListChange = function (info) {
                if (!initializing) {
                    console.log("userlist change");
                    console.log("There are now %s users", info.userList.length);
                    console.log(info.userList);
                    if (module.realtime) {
                        // bump contents when new people join.
                        module.realtime.bumpSharejs();
                    }
                }
            };

            var onInit = config.onInit = function (info) {
                var $bar = $('#cke_1_toolbox');
                toolbar = info.realtime.toolbar = Toolbar.create($bar, userName, info.realtime);
                /* handle disconnects somehow */
            };

            var realtime = module.realtime = Realtime.start(config);
            module.abortRealtime = function () {
                realtime.abort();
            };

            var updateTransport = module.updateTransport = function () {
                var hjson = Hyperjson.fromDOM(inner);
                $textarea.val(JSON.stringify(hjson));
                realtime.bumpSharejs();
            };

            editor.on('change', updateTransport);
        };

        var untilThen = function () {
            var $iframe = $('iframe');
            if (window.CKEDITOR &&
                window.CKEDITOR.instances && 
                window.CKEDITOR.instances.content &&
                $iframe.length &&
                $iframe[0].contentWindow &&
                $iframe[0].contentWindow.body) {
                return whenReady(window.CKEDITOR.instances.content, $iframe[0]);
            }
            setTimeout(untilThen, 100);
        };

        /* wait for the existence of CKEDITOR before doing things...  */
        untilThen();
    };

    return module;
});
