define([
    'RTWysiwyg_ErrorBox',
    'RTWysiwyg_WebHome_realtime_input',
    'RTWysiwyg_WebHome_hyperjson',
    'RTWysiwyg_WebHome_hyperscript',
    'RTWysiwyg_WebHome_toolbar',
    'RTWysiwyg_WebHome_cursor',
    'RTWysiwyg_WebHome_json_ot',
    'RTWysiwyg_WebHome_tests',
    'json.sortify',
    'RTWysiwyg_WebHome_text_patcher',
    'RTWysiwyg_WebHome_diffDOM',
    'jquery'
], function (ErrorBox, realtimeInput, Hyperjson, Hyperscript, Toolbar, Cursor, JsonOT, TypingTest, JSONSortify, TextPatcher) {
    var $ = window.jQuery;
    var DiffDom = window.diffDOM;

    /* REALTIME_DEBUG exposes a 'version' attribute.
        this must be updated with every release */
    var REALTIME_DEBUG = window.REALTIME_DEBUG = {
        version: '1.10',
        local: {},
        remote: {},
        Hyperscript: Hyperscript,
        Hyperjson: Hyperjson
    };

    // Create a fake "Crypto" object which will be passed to realtime-input
    var Crypto = {
        encrypt : function(msg, key) { return msg; },
        decrypt : function(msg, key) { return msg; },
        parseKey : function(key) { return {cryptKey : ''}; }
    }

    var stringify = function (obj) {
        return JSONSortify(obj);
    };

    window.Toolbar = Toolbar;
    window.Hyperjson = Hyperjson;

    var hjsonToDom = function (H) {
        return Hyperjson.callOn(H, Hyperscript);
    };

    /** Key in the localStore which indicates realtime activity should be disallowed. */
    var LOCALSTORAGE_DISALLOW = 'rtwysiwyg-disallow';

    var module = window.REALTIME_MODULE = {
        Hyperjson: Hyperjson,
        Hyperscript: Hyperscript
    };

    var uid = function () {
        return 'rtwiki-uid-' + String(Math.random()).substring(2);
    };

    var isNotMagicLine = function (el) {
        // factor as:
        // return !(el.tagName === 'SPAN' && el.contentEditable === 'false');
        var filter = (el.tagName === 'SPAN' && el.contentEditable === 'false');
        if (filter) {
            console.log("[hyperjson.serializer] prevented an element" +
                "from being serialized:", el);
            return false;
        }
        return true;
    };

    /* catch `type="_moz"` before it goes over the wire */
    var brFilter = function (hj) {
        if (hj[1].type === '_moz') { hj[1].type = undefined; }
        return hj;
    };

    var stringifyDOM = function (dom) {
        return stringify(Hyperjson.fromDOM(dom, isNotMagicLine, brFilter));
    };

    var main = module.main = function (WebsocketURL, userName, Messages, channel, DEMO_MODE, language) {

        var key = '';
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
            var cursor = window.cursor = Cursor(inner);

            var setEditable = module.setEditable = function (bool) {
                inner.setAttribute('contenteditable', bool);
            };

            // don't let the user edit until the pad is ready
            setEditable(false);

            var diffOptions = {
                preDiffApply: function (info) {
                    /* DiffDOM will filter out magicline plugin elements
                        in practice this will make it impossible to use it
                        while someone else is typing, which could be annoying.

                        we should check when such an element is going to be
                        removed, and prevent that from happening. */
                    if (info.node && info.node.tagName === 'SPAN' &&
                        info.node.getAttribute('contentEditable') === "false") {
                        // it seems to be a magicline plugin element...
                        if (info.diff.action === 'removeElement') {
                            // and you're about to remove it...
                            // this probably isn't what you want

                            /*
                                I have never seen this in the console, but the
                                magic line is still getting removed on remote
                                edits. This suggests that it's getting removed
                                by something other than diffDom.
                            */
                            console.log("preventing removal of the magic line!");

                            // return true to prevent diff application
                            return true;
                        }
                    }

                    // no use trying to recover the cursor if it doesn't exist
                    if (!cursor.exists()) { return; }

                    /*  frame is either 0, 1, 2, or 3, depending on which
                        cursor frames were affected: none, first, last, or both
                    */
                    var frame = info.frame = cursor.inNode(info.node);

                    if (!frame) { return; }

                    if (typeof info.diff.oldValue === 'string' && typeof info.diff.newValue === 'string') {
                        var pushes = cursor.pushDelta(info.diff.oldValue, info.diff.newValue);

                        if (frame & 1) {
                            // push cursor start if necessary
                            if (pushes.commonStart < cursor.Range.start.offset) {
                                cursor.Range.start.offset += pushes.delta;
                            }
                        }
                        if (frame & 2) {
                            // push cursor end if necessary
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
                        } else { console.error("info.node did not exist"); }

                        var sel = cursor.makeSelection();
                        var range = cursor.makeRange();

                        cursor.fixSelection(sel, range);
                    }
                }
            };


            var initializing = true;
            var userList = {}; // List of pretty name of all users (mapped with their server ID)
            var toolbarList; // List of users still connected to the channel (server IDs)
            var addToUserList = function(data) {
                for (var attrname in data) { userList[attrname] = data[attrname]; }
                if(toolbarList && typeof toolbarList.onChange === "function") {
                    toolbarList.onChange(userList);
                }
            };

            var myData = {};
            var myUserName = ''; // My "pretty name"
            var myID; // My server ID

            var setMyID = function(info) {
              myID = info.myID || null;
              myUserName = myID;
              myData[myID] = {
                name: userName
              };
              addToUserList(myData);
            };


            var DD = new DiffDom(diffOptions);

            // apply patches, and try not to lose the cursor in the process!
            var applyHjson = function (shjson) {
                var userDocStateDom = hjsonToDom(JSON.parse(shjson));
                userDocStateDom.setAttribute("contenteditable", "true"); // lol wtf
                var patch = (DD).diff(inner, userDocStateDom);
                (DD).apply(inner, patch);
            };

            var stringifyDOM = function (dom) {
                var hjson = Hyperjson.fromDOM(dom, isNotMagicLine, brFilter);
                hjson[3] = {metadata: userList};
                return stringify(hjson);
            };

            var realtimeOptions = {
                // provide initialstate...
                initialState: stringifyDOM(inner) || '{}',

                // the websocket URL
                websocketURL: WebsocketURL,

                // our username
                userName: userName,

                // the channel we will communicate over
                channel: channel,

                // our encryption key
                cryptKey: key,


                // method which allows us to get the id of the user
                setMyID: setMyID,

                // Crypto object to avoid loading it twice in Cryptpad
                crypto: Crypto,

                // really basic operational transform
                transformFunction : JsonOT.validate
            };
            var updateUserList = function(shjson) {
                // Extract the user list (metadata) from the hyperjson
                var hjson = JSON.parse(shjson);
                var peerUserList = hjson[3];
                if(peerUserList && peerUserList.metadata) {
                  var userData = peerUserList.metadata;
                  // Update the local user data
                  addToUserList(userData);
                  hjson.pop();
                }
            }

            var onRemote = realtimeOptions.onRemote = function (info) {
                if (initializing) { return; }

                var shjson = info.realtime.getUserDoc();

                // remember where the cursor is
                cursor.update();

                updateUserList(shjson);

                // build a dom from HJSON, diff, and patch the editor
                applyHjson(shjson);

                var shjson2 = stringifyDOM(inner);
                if (shjson2 !== shjson) {
                    console.error("shjson2 !== shjson");
                    module.patchText(shjson2);
                }
            };

            var onInit = realtimeOptions.onInit = function (info) {
                var $bar = $('#cke_1_toolbox');
                toolbarList = info.userList;
                var config = {
                    userData: userList
                    // changeNameID: 'cryptpad-changeName'
                };
                toolbar = Toolbar.create($bar, info.myID, info.realtime, info.getLag, info.userList, config);
            };

            var onReady = realtimeOptions.onReady = function (info) {
                module.patchText = TextPatcher.create({
                    realtime: info.realtime,
                    logging: false,
                });

                module.realtime = info.realtime;

                var shjson = info.realtime.getUserDoc();

                // Update the user list to link the wiki name to the user id
                updateUserList(shjson);

                applyHjson(shjson);

                console.log("Unlocking editor");
                initializing = false;
                setEditable(true);
            };

            var onAbort = realtimeOptions.onAbort = function (info) {
                console.log("Aborting the session!");
                // TODO inform them that the session was torn down
                toolbar.failed();
                toolbar.destroy();
            };

            var onLocal = realtimeOptions.onLocal = function () {
                if (initializing) { return; }


                // stringify the json and send it into chainpad
                var shjson = stringifyDOM(inner);
                module.patchText(shjson);

                if (module.realtime.getUserDoc() !== shjson) {
                    console.error("realtime.getUserDoc() !== shjson");
                }
            };

            var rti = module.realtimeInput = realtimeInput.start(realtimeOptions);
            module.abortRealtime = function () {
                module.realtime.abort();
            };

            /* hitting enter makes a new line, but places the cursor inside
                of the <br> instead of the <p>. This makes it such that you
                cannot type until you click, which is rather unnacceptable.
                If the cursor is ever inside such a <br>, you probably want
                to push it out to the parent element, which ought to be a
                paragraph tag. This needs to be done on keydown, otherwise
                the first such keypress will not be inserted into the P. */
            inner.addEventListener('keydown', cursor.brFix);

            editor.on('change', onLocal);

            // export the typing tests to the window.
            // call like `test = easyTest()`
            // terminate the test like `test.cancel()`
            var easyTest = window.easyTest = function () {
                cursor.update();
                var start = cursor.Range.start;
                var test = TypingTest.testInput(inner, start.el, start.offset, onLocal);
                onLocal();
                return test;
            };
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
