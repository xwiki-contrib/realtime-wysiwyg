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
], function (ErrorBox, Realtime, Hyperjson, Hyperscript, Toolbar, Cursor, JsonOT, DiffDom) {
    // be very careful, dumping jquery as '$' into the global scope will break
    // prototype js bindings
    var $ = window.jQuery;
    var DiffDom = window.diffDOM;

    /* REALTIME_DEBUG exposes a 'version' attribute.
        this must be updated with every release */
    var REALTIME_DEBUG = window.REALTIME_DEBUG = {
        version: '1.15',
        local: {},
        remote: {},
        Hyperscript: Hyperscript,
        Hyperjson: Hyperjson
    };

    /** Key in the localStore which indicates realtime activity should be disallowed. */
    var LOCALSTORAGE_DISALLOW = 'rtwysiwyg-disallow';

    var module = {};

    var uid = function () {
        return 'rtwiki-uid-' + String(Math.random()).substring(2);
    };

    var isNotMagicLine = function (el) {
        var filter = (el.tagName === 'SPAN' && el.contentEditable === 'false');
        if (filter) {
            console.log("[hyperjson.serializer] prevented and element " +
                "from being serialized", el);
            return false;
        }
        return true;
    };

    var brFilter = function (hj) {
        if (hj[1].type === '_moz') { hj[1].type = undefined; }
        return hj;
    };

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
            var inner = REALTIME_DEBUG.inner = iframe.contentWindow.body;

            // TODO add UI hints for when the contenteditable is disabled
            var setEditable = function (bool) {
                inner.setAttribute('contenteditable', bool);
            };

            var initializing = true;
            // disable CKEditor until the realtime is ready
            setEditable(false);

            var config = {
                websocketURL: WebsocketURL,
                userName: userName,
                channel: channel,
                initialState: JSON.stringify(Hyperjson.fromDOM(inner)),
                transformFunction: JsonOT.validate
            };

            var cursor = window.cursor = Cursor(inner);

            // TODO don't wipe out the magicline plugin when receiving patches
            var diffOptions = {
                preDiffApply: function (info) {
                    /*  Don't remove local instances of the magicline plugin */
                    if (info.node && info.node.tagName === 'SPAN' &&
                        info.node.contentEditable === 'true') {
                        return true;
                    }

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

                var userDocStateDom;
                try {
                    userDocStateDom = Hyperjson.callOn(parsed, Hyperscript);
                } catch (err) {
                    /*  if you get a patch that you can't render, it
                        is probably a broken patch for everyone. Steamroll
                        the error by propogating your own current state back
                        over the wire, so they correct to your current state.
                        This should get the session back on track.
                    */
                    console.log('[applyHjson] err converting hyperjson to dom');
                    console.error(err);
                    // push your current state back over the wire
                    module.updateTransport();
                    return;
                }
                userDocStateDom.setAttribute("contenteditable", true);
                var DD = new DiffDom(diffOptions);
                var patch = DD.diff(inner, userDocStateDom);
                DD.apply(inner, patch);
            };

            var onRemote = config.onRemote = function (info) {
                if (initializing) { return; }
                cursor.update();

                var userDoc = REALTIME_DEBUG.remote.userDoc = info.realtime.getUserDoc();

                var parsed = REALTIME_DEBUG.remote.hjson = JSON.parse(userDoc);

                applyHjson(parsed);

                var userDoc2 = JSON.stringify(Hyperjson.fromDOM(inner));
                if (userDoc !== userDoc2) {
                    console.error("userDoc !== userDoc2");
                    module.realtime.patchText(userDoc2);
                }
            };

            // TODO ErrorBox, tell the user the session was aborted
            var onAbort = config.onAbort = function (info) {
                if (info.initError) {
                    // initialization error, abort before initializing.
                    console.log("Failed to initialize the realtime session. " +
                        "Falling back to offline editor behaviour.");
                    setEditable(true);
                } else {
                    // default abort behaviour
                    var realtime = info.socket.realtime;
                    realtime.toolbar.failed();
                    toolbar.destroy();
                }
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

                    console.log("Readying new document");
                    onRemote(info);
                    return;
                }

                applyHjson(parsed);
            };

            var onUserListChange = config.onUserListChange = function (info) {
                if (!initializing) {
                    console.log("userlist change");
                    console.log("There are now %s users", info.userList.length);
                    console.log(info.userList);
                    if (module.updateTransport) {
                        module.updateTransport();
                    }
                }
            };

            var onInit = config.onInit = function (info) {
                var $bar = $('#cke_1_toolbox');
                toolbar = info.realtime.toolbar = Toolbar.create($bar, userName, info.realtime);
                /* handle disconnects somehow */
            };

            // TODO rename this, as 'realtime' already has other meanings
            var realtime = module.realtime = REALTIME_DEBUG.realtime = Realtime.start(config);
            module.abortRealtime = function () {
                realtime.abort();
            };

            /* TODO
                don't send magicline elements over the wire
                don't send type="_moz" over the wire
            */

            // assign onLocal to realtime for internal use
            var updateTransport = module.updateTransport = realtime.onLocal= function () {
                var hjson = Hyperjson.fromDOM(inner, isNotMagicLine, brFilter);

                REALTIME_DEBUG.local.hjson = hjson;
                var shjson = JSON.stringify(hjson);
                if (!realtime.patchText(shjson)) {
                    return;
                }
                realtime.onEvent(shjson);
            };

            /*  This exposes a test that you can call at the console.
                Send arbitrary bad content into Chainpad and over the wire.
                See how your friends handle it.
            */
            var sendBadContent = REALTIME_DEBUG.sendBadContent = function (C) {
                realtime.patchText(C);
            };

            editor.on('change', updateTransport);
            $(inner).on('keydown', cursor.brFix);
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
