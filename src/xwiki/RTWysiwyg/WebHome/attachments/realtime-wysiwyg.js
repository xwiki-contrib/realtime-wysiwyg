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
    'jquery',
    'RTWysiwyg_WebHome_html_patcher',
    'RTWysiwyg_ErrorBox',
    'RTWysiwyg_WebHome_rangy',
    'RTWysiwyg_WebHome_chainpad',
    'RTWysiwyg_WebHome_otaml'
], function ($, HTMLPatcher, ErrorBox) {

    var Rangy = window.rangy;
    Rangy.init();
    var ChainPad = window.ChainPad;
    var Otaml = window.Otaml;
    var PARANOIA = true;

    var module = { exports: {} };

    /**
     * If an error is encountered but it is recoverable, do not immediately fail
     * but if it keeps firing errors over and over, do fail.
     */
    var MAX_RECOVERABLE_ERRORS = 15;

    /** Maximum number of milliseconds of lag before we fail the connection. */
    var MAX_LAG_BEFORE_DISCONNECT = 20000;

    /** Id of the element for getting debug info. */
    var DEBUG_LINK_CLS = 'rtwysiwyg-debug-link';

    /** Id of the div containing the user list. */
    var USER_LIST_CLS = 'rtwysiwyg-user-list';

    /** Id of the div containing the lag info. */
    var LAG_ELEM_CLS = 'rtwysiwyg-lag';

    /** The toolbar class which contains the user list, debug link and lag. */
    var TOOLBAR_CLS = 'rtwysiwyg-toolbar';

    /** Key in the localStore which indicates realtime activity should be disallowed. */
    var LOCALSTORAGE_DISALLOW = 'rtwysiwyg-disallow';

    // ------------------ Trapping Keyboard Events ---------------------- //

    var bindEvents = function (element, events, callback, unbind) {
        for (var i = 0; i < events.length; i++) {
            var e = events[i];
            if (element.addEventListener) {
                if (unbind) {
                    element.removeEventListener(e, callback, false);
                } else {
                    element.addEventListener(e, callback, false);
                }
            } else {
                if (unbind) {
                    element.detachEvent('on' + e, callback);
                } else {
                    element.attachEvent('on' + e, callback);
                }
            }
        }
    };

    var bindAllEvents = function (wysiwygDiv, docBody, onEvent, unbind)
    {
        bindEvents(docBody,
                   ['textInput', 'keydown', 'keyup', 'select', 'cut', 'paste'],
                   onEvent,
                   unbind);
        bindEvents(wysiwygDiv,
                   ['mousedown','mouseup','click'],
                   onEvent,
                   unbind);
    };

    var updateUserList = function (myUserName, listElement, userList)
    {
        var meIdx = userList.indexOf(myUserName);
        if (meIdx === -1) {
            //console.log("user list ["+userList+"] does not contain self ["+myUserName+"]...");
            listElement.textContent = "Disconnected";
            return;
        }
        var userMap = { "Myself":1 };
        userList.splice(meIdx, 1);
        for (var i = 0; i < userList.length; i++) {
            var user = userList[i].replace(/-.*/, '');
            if (user === 'xwiki:XWiki.XWikiGuest') {
                if (userMap['Guests']) {
                    user = 'Guests';
                } else {
                    user = 'Guest';
                }
            }
            userMap[user] = userMap[user] || 0;
            if (user === 'Guest' && userMap[user] > 0) {
                userMap['Guests'] = userMap[user];
                delete userMap[user];
                user = 'Guests';
            }
            userMap[user]++;
        }
        var userListOut = [];
        for (var name in userMap) {
            if (userMap[name] > 1) {
                userListOut.push(userMap[name] + " " + name);
            } else {
                userListOut.push(name);
            }
        }
        if (userListOut.length > 1) {
            userListOut[userListOut.length-1] = 'and ' + userListOut[userListOut.length-1];
        }
        listElement.textContent = 'Editing with: ' + userListOut.join(', ');
    };

    var checkLag = function (realtime, lagElement) {
        var lag = realtime.getLag();
        var lagSec = lag.lag/1000;
        lagElement.textContent = "Lag: ";
        if (lag.waiting && lagSec > 1) {
            lagElement.textContent += "?? " + Math.floor(lagSec);
        } else {
            lagElement.textContent += lagSec;
        }
    };

    var isSocketDisconnected = function (socket, realtime) {
        return socket._socket.readyState === socket.CLOSING
            || socket._socket.readyState === socket.CLOSED
            || (realtime.getLag().waiting && realtime.getLag().lag > MAX_LAG_BEFORE_DISCONNECT);
    };

    var updateUserList = function (myUserName, listElement, userList, messages) {
        var meIdx = userList.indexOf(myUserName);
        if (meIdx === -1) {
            listElement.text(messages.disconnected);
            return;
        }
        var userMap = {};
        userMap[messages.myself] = 1;
        userList.splice(meIdx, 1);
        for (var i = 0; i < userList.length; i++) {
            var user;
            if (userList[i].indexOf('xwiki:XWiki.XWikiGuest') === 0) {
                if (userMap.Guests) {
                    user = messages.guests;
                } else {
                    user = messages.guest;
                }
            } else {
                user = userList[i].replace(/^.*-([^-]*)%2d[0-9]*$/, function(all, one) {
                    return decodeURIComponent(one);
                });
            }
            userMap[user] = userMap[user] || 0;
            if (user === messages.guest && userMap[user] > 0) {
                userMap.Guests = userMap[user];
                delete userMap[user];
                user = messages.guests;
            }
            userMap[user]++;
        }
        var userListOut = [];
        for (var name in userMap) {
            if (userMap[name] > 1) {
                userListOut.push(userMap[name] + " " + name);
            } else {
                userListOut.push(name);
            }
        }
        if (userListOut.length > 1) {
            userListOut[userListOut.length-1] =
                messages.and + ' ' + userListOut[userListOut.length-1];
        }
        listElement.text(messages.editingWith + ' ' + userListOut.join(', '));
    };

    var createUserList = function (realtime, myUserName, container, messages) {
        var id = uid();
        $(container).prepend('<div class="' + USER_LIST_CLS + '" id="'+id+'"></div>');
        var listElement = $('#'+id);
        realtime.onUserListChange(function (userList) {
            updateUserList(myUserName, listElement, userList, messages);
        });
        return listElement;
    };

    var abort = function (socket, realtime) {
        realtime.abort();
        try { socket._socket.close(); } catch (e) { }
        $('.'+USER_LIST_CLS).text("Disconnected");
        $('.'+LAG_ELEM_CLS).text("");
    };

    var createDebugInfo = function (cause, realtime, docHTML, allMessages) {
        return JSON.stringify({
            cause: cause,
            realtimeUserDoc: realtime.getUserDoc(),
            realtimeAuthDoc: realtime.getAuthDoc(),
            docHTML: docHTML,
            allMessages: allMessages,
        });
    };

    var handleError = function (socket, realtime, err, docHTML, allMessages) {
        var internalError = createDebugInfo(cause, realtime, docHTML, allMessages);
        abort(socket, realtime);
        ErrorBox.show('error', docHTML, internalError);
    };

    var getDocHTML = function (doc) {
        return doc.body.innerHTML;
    };

    var makeHTMLOperation = function (oldval, newval) {
        try {
            var op = Otaml.makeHTMLOperation(oldval, newval);

            if (PARANOIA && op) {
                // simulate running the patch.
                var res = HTMLPatcher.patchString(oldval, op.offset, op.toRemove, op.toInsert);
                if (res !== newval) {
                    console.log(op);
                    console.log(oldval);
                    console.log(newval);
                    console.log(res);
                    throw new Error();
                }

                // check matching bracket count
                // TODO(cjd): this can fail even if the patch is valid because of brackets in
                //            html attributes.
                var removeText = oldval.substring(op.offset, op.offset + op.toRemove);
                if (((removeText).match(/</g) || []).length !==
                    ((removeText).match(/>/g) || []).length)
                {
                    throw new Error();
                }

                if (((op.toInsert).match(/</g) || []).length !==
                    ((op.toInsert).match(/>/g) || []).length)
                {
                    throw new Error();
                }
            }

            return op;

        } catch (e) {
            if (PARANOIA) {
                $(document.body).append('<textarea id="makeOperationErr"></textarea>');
                $('#makeOperationErr').val(oldval + '\n\n\n\n\n\n\n\n\n\n' + newval);
                console.log(e.stack);
            }
            return {
                offset: 0,
                toRemove: oldval.length,
                toInsert: newval
            };
        }
    };

    // chrome sometimes generates invalid html but it corrects it the next time around.
    var fixChrome = function (docText, doc, contentWindow) {
        for (var i = 0; i < 10; i++) {
            var docElem = doc.createElement('div');
            docElem.innerHTML = docText;
            var newDocText = docElem.innerHTML;
            var fixChromeOp = makeHTMLOperation(docText, newDocText);
            if (!fixChromeOp) { return docText; }
            HTMLPatcher.applyOp(docText,
                                fixChromeOp,
                                doc.body,
                                Rangy,
                                contentWindow);
            docText = getDocHTML(doc);
            if (newDocText === docText) { return docText; }
        }
        throw new Error();
    };

    var fixSafari_STATE_OUTSIDE = 0;
    var fixSafari_STATE_IN_TAG =  1;
    var fixSafari_STATE_IN_ATTR = 2;
    var fixSafari_HTML_ENTITIES_REGEX = /('|"|<|>|&lt;|&gt;)/g;

    var fixSafari = function (html) {
        var state = fixSafari_STATE_OUTSIDE;
        return html.replace(fixSafari_HTML_ENTITIES_REGEX, function (x) {
            switch (state) {
                case fixSafari_STATE_OUTSIDE: {
                    if (x === '<') { state = fixSafari_STATE_IN_TAG; }
                    return x;
                }
                case fixSafari_STATE_IN_TAG: {
                    switch (x) {
                        case '"': state = fixSafari_STATE_IN_ATTR; break;
                        case '>': state = fixSafari_STATE_OUTSIDE; break;
                        case "'": throw new Error("single quoted attribute");
                    }
                    return x;
                }
                case fixSafari_STATE_IN_ATTR: {
                    switch (x) {
                        case '&lt;': return '<';
                        case '&gt;': return '>';
                        case '"': state = fixSafari_STATE_IN_TAG; break;
                    }
                    return x;
                }
            };
            throw new Error();
        });
    };

    var checkSectionEdit = function () {
        var href = window.location.href;
        if (href.indexOf('#') === -1) { href += '#!'; }
        var si = href.indexOf('section=');
        if (si === -1 || si > href.indexOf('#')) { return false; }
        var m = href.match(/([&]*section=[0-9]+)/)[1];
        href = href.replace(m, '');
        if (m[0] === '&') { m = m.substring(1); }
        href = href + '&' + m;
        window.location.href = href;
        return true;
    };

    var uid = function () {
        return 'rtwysiwyg-uid-' + String(Math.random()).substring(2);
    };

    var createDebugLink = function (realtime, iframeDoc, allMessages, toolbar, messages) {
        var id = uid();
        toolbar.find('.rtwysiwyg-toolbar-rightside').append(
            '<a href="#" id="' + id + '" class="' + DEBUG_LINK_CLS + '">' + messages.debug + '</a>'
        );
        $('#'+id).on('click', function () {
            var debugInfo =
                createDebugInfo('debug button', realtime, getDocHTML(iframeDoc), allMessages);
            ErrorBox.show('debug', '', debugInfo);
        });
    };

    var checkLag = function (realtime, lagElement, messages) {
        var lag = realtime.getLag();
        var lagSec = lag.lag/1000;
        var lagMsg = messages.lag + ' ';
        if (lag.waiting && lagSec > 1) {
            lagMsg += "?? " + Math.floor(lagSec);
        } else {
            lagMsg += lagSec;
        }
        lagElement.text(lagMsg);
    };

    var createLagElement = function (socket, realtime, container, messages) {
        var id = uid();
        $(container).append('<div class="' + LAG_ELEM_CLS + '" id="'+id+'"></div>');
        var lagElement = $('#'+id);
        var intr = setInterval(function () {
            checkLag(realtime, lagElement, messages);
        }, 3000);
        socket.onClose.push(function () { clearTimeout(intr); });
        return lagElement;
    };

    var createRealtimeToolbar = function (container) {
        var id = uid();
        $(container).prepend(
            '<div class="' + TOOLBAR_CLS + '" id="' + id + '">' +
                '<div class="rtwysiwyg-toolbar-leftside"></div>' +
                '<div class="rtwysiwyg-toolbar-rightside"></div>' +
            '</div>'
        );
        var toolbar = $('#'+id);
        toolbar.append([
            '<style>',
            '.' + TOOLBAR_CLS + ' {',
            '    color: #666;',
            '    font-weight: bold;',
            '    background-color: #f0f0ee;',
            '    border-bottom: 1px solid #DDD;',
            '    border-top: 3px solid #CCC;',
            '    border-right: 2px solid #CCC;',
            '    border-left: 2px solid #CCC;',
            '    height: 26px;',
            '    margin-bottom: -3px;',
            '    display: inline-block;',
            '    width: 100%;',
            '}',
            '.' + TOOLBAR_CLS + ' div {',
            '    padding: 0 10px;',
            '    height: 1.5em;',
            '    background: #f0f0ee;',
            '    line-height: 25px;',
            '    height: 22px;',
            '}',
            '.rtwysiwyg-toolbar-leftside {',
            '    float: left;',
            '}',
            '.rtwysiwyg-toolbar-rightside {',
            '    float: right;',
            '}',
            '.rtwysiwyg-lag {',
            '    float: right;',
            '}',
            '.gwt-TabBar {',
            '    display:none;',
            '}',
            '.' + DEBUG_LINK_CLS + ':link { color:transparent; }',
            '.' + DEBUG_LINK_CLS + ':link:hover { color:blue; }',
            '.gwt-TabPanelBottom { border-top: 0 none; }',
            '</style>'
         ].join('\n'));
        return toolbar;
    };

    var makeWebsocket = function (url) {
        var socket = new WebSocket(url);
        var out = {
            onOpen: [],
            onClose: [],
            onError: [],
            onMessage: [],
            send: function (msg) { socket.send(msg); },
            close: function () { socket.close(); },
            _socket: socket
        };
        var mkHandler = function (name) {
            return function (evt) {
                for (var i = 0; i < out[name].length; i++) {
                    if (out[name][i](evt) === false) { return; }
                }
            };
        };
        socket.onopen = mkHandler('onOpen');
        socket.onclose = mkHandler('onClose');
        socket.onerror = mkHandler('onError');
        socket.onmessage = mkHandler('onMessage');
        return out;
    };

    var startWebSocket = function (websocketUrl, userName, messages, channel, demoMode, language)
    {
        var passwd = 'y';
        var wysiwygDiv = document.getElementsByClassName('xRichTextEditor')[0];
        var ifr = wysiwygDiv.getElementsByClassName('gwt-RichTextArea')[0];
        var doc = ifr.contentWindow.document;
        var socket = makeWebsocket(websocketUrl);

        var toolbar = createRealtimeToolbar('#xwikieditcontent');

        socket.onClose.push(function () {
            $(toolbar).remove();
        });

        var allMessages = [];
        var isErrorState = false;
        var initializing = true;
        var recoverableErrorCount = 0;
        var error = function (recoverable, err) {
            if (recoverable && recoverableErrorCount++ < MAX_RECOVERABLE_ERRORS) { return; }
            isErrorState = true;
            handleError(socket, socket.realtime, err, getDocHTML(doc), allMessages);
        };
        var attempt = function (func) {
            return function () {
                try {
                    return func.apply(func, arguments);
                } catch (e) {
                    error(true, e);
                    throw e;
                }
            };
        };
        var checkSocket = function () {
            if (isSocketDisconnected(socket, realtime) && !socket.intentionallyClosing) {
                isErrorState = true;
                abort(socket, realtime);
                ErrorBox.show('disconnected', getDocHTML(doc));
                return true;
            }
            return false;
        };

        socket.onOpen.push(function(evt) {

            var realtime = socket.realtime =
                ChainPad.create(userName,
                                passwd,
                                channel,
                                getDocHTML(doc),
                                { transformFunction: Otaml.transform });

            createDebugLink(realtime, doc, allMessages, toolbar, messages);

            createLagElement(socket,
                             realtime,
                             toolbar.find('.rtwysiwyg-toolbar-rightside'),
                             messages);

            createUserList(realtime,
                           userName,
                           toolbar.find('.rtwysiwyg-toolbar-leftside'),
                           messages);

            var onEvent = function () {
                if (isErrorState) { return; }
                if (initializing) { return; }

                var oldDocText = realtime.getUserDoc();

                var docText = getDocHTML(doc);

                //attempt(fixChrome)(docText, doc, ifr.contentWindow);
                //docText = attempt(fixSafari)(docText);
                docText = fixChrome(docText, doc, ifr.contentWindow);
                docText = fixSafari(docText);

                if (oldDocText === docText) { return; }

                var op = attempt(Otaml.makeTextOperation)(oldDocText, docText);

                if (op.toRemove > 0) {
                    attempt(realtime.remove)(op.offset, op.toRemove);
                }
                if (op.toInsert.length > 0) {
                    attempt(realtime.insert)(op.offset, op.toInsert);
                }

                if (realtime.getUserDoc() !== docText) {
                    error(true, 'realtime.getUserDoc() !== docText');
                    throw new Error('realtime.getUserDoc() !== docText');
                }
            };

            var incomingPatch = function () {
                if (isErrorState) { return; }

                // When we first connect, we have to "sync the chain"
                // this is an optimization to not fully handle all patches until we're synced.
                if (initializing) { return; }

                var docText = getDocHTML(doc);
                var rtDoc = realtime.getUserDoc();
                var op = attempt(makeHTMLOperation)(docText, rtDoc);
                if (!op) { return; }
                attempt(HTMLPatcher.applyOp)(docText, op, doc.body, rangy, ifr.contentWindow);
            };

            realtime.onUserListChange(function (userList) {
                if (userList.indexOf(userName) > -1 && initializing) {
                    // Second half of a piece of cleverness which relies on the fact that
                    // nobody is going to care much about the state of the document until
                    // they have downloaded all patches.
                    initializing = false;
                    incomingPatch();
                }
            });

            socket.onMessage.push(function (evt) {
                if (isErrorState) { return; }
                allMessages.push(evt.data);
                // paranoia
                onEvent();
                realtime.message(evt.data);
            });
            realtime.onMessage(function (message) {
                if (isErrorState) { return; }
                try {
                    socket.send(message);
                } catch (e) {
                    if (!checkSocket()) { error(true, e.stack); }
                }
            });

            realtime.onPatch(incomingPatch);

            socket.onError.push(function (err) {
                if (isErrorState) { return; }
                if (!checkSocket()) { error(true, err); }
            });

            bindAllEvents(wysiwygDiv, doc.body, onEvent, false);

            setInterval(function () {
                if (isErrorState) { return; }
                // reconnect if the iframe changes...
                if (ifr === document.getElementsByClassName('gwt-RichTextArea')[0]) { return; }
                bindAllEvents(wysiwygDiv, doc.body, onEvent, true);
                wysiwygDiv = document.getElementsByClassName('xRichTextEditor')[0];
                ifr = wysiwygDiv.getElementsByClassName('gwt-RichTextArea')[0];
                doc = ifr.contentWindow.document;
                bindAllEvents(wysiwygDiv, doc.body, onEvent, false);
                onEvent();
            }, 200);

            realtime.start();

            //console.log('started');
        });
        return socket;
    };

    var stopWebSocket = function (socket) {
        if (!socket) { return; }
        socket.intentionallyClosing = true;
        if (socket.realtime) { socket.realtime.abort(); }
        socket.close();
    };

    var editor = function (websocketUrl, userName, messages, channel, demoMode, language) {

        if (checkSectionEdit()) { return; }

        var checked = (localStorage.getItem(LOCALSTORAGE_DISALLOW)) ? "" : 'checked="checked"';
        var allowRealtimeCbId = uid();
        $('#mainEditArea .buttons').append(
            '<div class="rtwysiwyg-allow-outerdiv">' +
                '<label class="rtwysiwyg-allow-label" for="' + allowRealtimeCbId + '">' +
                    '<input type="checkbox" class="rtwysiwyg-allow" id="' + allowRealtimeCbId +
                        '" ' + checked + '" />' +
                    ' ' + messages.allowRealtime +
                '</label>' +
            '</div>'
        );

        var socket;
        var checkboxClick = function (checked) {
            if (checked || demoMode) {
                localStorage.removeItem(LOCALSTORAGE_DISALLOW);
                socket = startWebSocket(websocketUrl,
                                        userName,
                                        messages,
                                        channel,
                                        demoMode,
                                        language);
            } else if (socket) {
                localStorage.setItem(LOCALSTORAGE_DISALLOW, 1);
                stopWebSocket(socket);
                socket = undefined;
            }
        };
        $('#'+allowRealtimeCbId).click(function () { checkboxClick(this.checked); });
        checkboxClick(checked);
    };

    var waitForWysiwyg = function (func) {
        var ifr = document.getElementsByClassName('gwt-RichTextArea');
        if (ifr[0] && ifr[0].contentWindow) {
            func();
        } else {
            setTimeout(function () { waitForWysiwyg(func); }, 10);
        }
    };

    var main = module.exports.main =
        function (websocketUrl, userName, messages, channel, demoMode, language)
    {
        if (!websocketUrl) {
            throw new Error("No WebSocket URL, please ensure Realtime Backend is installed.");
        }

        // Either we are in edit mode or the document is locked.
        // There is no cross-language way that the UI tells us the document is locked
        // but we can hunt for the force button.
        var forceLink = $('a[href$="&force=1"][href*="/edit/"]');

        var hasActiveRealtimeSession = function () {
            forceLink.text(messages.joinSession);
            var href = forceLink.attr('href');
            href = href.replace(/editor=(wiki|inline)[\&]?/, '');
            href = href + '&editor=wysiwyg';
            forceLink.attr('href', href);
        };

        if (forceLink.length && !localStorage.getItem(LOCALSTORAGE_DISALLOW)) {
            // ok it's locked.
            var socket = new WebSocket(websocketUrl);
            socket.onopen = function (evt) {
                socket.onmessage = function (evt) {
                    if (evt.data !== ('0:' + channel.length + ':' + channel + '5:[1,0]')) {
                        socket.close();
                        hasActiveRealtimeSession();
                    }
                };
                socket.send('1:x' + userName.length + ':' + userName +
                    channel.length + ':' + channel + '3:[0]');
            };
        } else if (window.XWiki.editor === 'wysiwyg' || demoMode) {
            // xwiki:wysiwyg:showWysiwyg appears unreliable.
            document.observe('xwiki:wysiwyg:showWysiwyg', function () {
                waitForWysiwyg(function () {
                    editor(websocketUrl, userName, messages, channel, demoMode, language);
                });
            });
        }
    };

    return module.exports;
});
