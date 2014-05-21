/* vim: set expandtab ts=4 sw=4: */
/*
 * You may redistribute this program and/or modify it under the terms of
 * the GNU Lesser General Public License as published by the Free Software
 * Foundation, either version 2.1 of the License, or (at your option) any
 * later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
define([
    'RTWysiwyg_WebHome_html_patcher',
    'RTWysiwyg_ErrorBox',
    'RTWysiwyg_WebHome_rangy',
    'RTWysiwyg_WebHome_chainpad'
], function (HTMLPatcher, ErrorBox) {

    var Rangy = window.rangy;
    Rangy.init();
    var ChainPad = window.ChainPad;

    var module = { exports: {} };

    /**
     * If an error is encountered but it is recoverable, do not immediately fail
     * but if it keeps firing errors over and over, do fail.
     */
    var MAX_RECOVERABLE_ERRORS = 15;

    /** Maximum number of milliseconds of lag before we fail the connection. */
    var MAX_LAG_BEFORE_DISCONNECT = 20000;

    /** Id of the element for getting debug info. */
    var DEBUG_LINK_ID = 'realtime-debug-link';

    /** Id of the div containing the user list. */
    var USER_LIST_ID = 'realtime-user-list';

    /** Id of the div containing the lag info. */
    var LAG_ELEM_ID = 'realtime-lag';

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
            console.log("user list ["+userList+"] does not contain self ["+myUserName+"]...");
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
        return socket.readyState === socket.CLOSING
            || socket.readyState === socket.CLOSED
            || (realtime.getLag().waiting && realtime.getLag().lag > MAX_LAG_BEFORE_DISCONNECT);
    };

    var abort = function (socket, realtimeUserList, realtime) {
        realtime.abort();
        try { socket.close(); } catch (e) { }
        var userList = document.getElementById(USER_LIST_ID);
        if (userList) { userList.textContent = "Disconnected"; }
        var lag = document.getElementById(LAG_ELEM_ID);
        if (lag) { lag.textContent = ''; }
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

    // chrome sometimes generates invalid html but it corrects it the next time around.
    var fixChrome = function (docText, doc, contentWindow) {
        var docElem = doc.createElement('div');
        docElem.innerHTML = docText;
        var newDocText = docElem.innerHTML;
        var fixChromeOp = HTMLPatcher.makeHTMLOperation(docText, newDocText);
        if (fixChromeOp) {
            HTMLPatcher.applyOp(docText,
                                fixChromeOp,
                                doc.body,
                                Rangy,
                                contentWindow);
            docText = getDocHTML(doc);
            if (newDocText !== docText) { throw new Error(); }
        }
    };

    var attachDebugClickHandler = function (realtime, iframeDoc, allMessages) {
        var link = document.getElementById(DEBUG_LINK_ID);
        if (!link) { return; }
        link.onclick = function () {
            var debugInfo =
                createDebugInfo('debug button', realtime, getDocHTML(iframeDoc), allMessages);
            ErrorBox.show('debug', '', debugInfo);
        };
    };

    var start = module.exports.start = function (userName, channel, sockUrl) {
        var passwd = 'y';
        var wysiwygDiv = document.getElementsByClassName('xRichTextEditor')[0];
        var ifr = wysiwygDiv.getElementsByClassName('gwt-RichTextArea')[0];
        var doc = ifr.contentWindow.document;
        var socket = new WebSocket(sockUrl);

        var allMessages = [];
        var isErrorState = false;
        var initializing = true;
        var recoverableErrorCount = 0;
        var error = function (recoverable, err) {
            if (recoverable && recoverableErrorCount++ < MAX_RECOVERABLE_ERRORS) { return; }
            isErrorState = true;
            handleError(socket, realtime, err, getDocHTML(doc), allMessages);
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
            if (isSocketDisconnected(socket, realtime)) {
                isErrorState = true;
                abort(socket, realtime);
                ErrorBox.show('disconnected', getDocHTML(doc));
                return true;
            }
            return false;
        };

        socket.onopen = function(evt) {
            realtime = ChainPad.create(userName, passwd, channel, getDocHTML(doc), {});

            attachDebugClickHandler(realtime, doc, allMessages);

            var onEvent = function () {
                if (isErrorState) { return; }
                if (initializing) { return; }

                var oldDocText = realtime.getUserDoc();

                var docText = getDocHTML(doc);
                if (oldDocText === docText) { return; }

                attempt(fixChrome)(docText, doc, ifr.contentWindow);

                var op = attempt(HTMLPatcher.makeHTMLOperation)(oldDocText, docText);

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
                if (docText === rtDoc) { return; }
                var op = attempt(HTMLPatcher.makeHTMLOperation)(docText, rtDoc);
                attempt(HTMLPatcher.applyOp)(docText, op, doc.body, rangy, ifr.contentWindow);
            };

            socket.onmessage = function (evt) {
                if (isErrorState) { return; }
                allMessages.push(evt.data);
                // paranoia
                onEvent();
                realtime.message(evt.data);
            };
            realtime.onMessage(function (message) {
                if (isErrorState) { return; }
                try {
                    socket.send(message);
                } catch (e) {
                    if (!checkSocket()) { error(true, e.stack); }
                }
            });

            realtime.onPatch(incomingPatch);

            var realtimeUserList = document.getElementById(USER_LIST_ID);
            if (realtimeUserList) {
                realtime.onUserListChange(function (userList) {
                    if (isErrorState) { return; }
                    if (userList.indexOf(userName) > -1 && initializing) {
                        // Second half of a piece of cleverness which relies on the fact that
                        // nobody is going to care much about the state of the document until
                        // they have downloaded all patches.
                        initializing = false;
                        incomingPatch();
                    }
                    updateUserList(userName, realtimeUserList, userList);
                });
            }

            var realtimeLag = document.getElementById(LAG_ELEM_ID);
            if (realtimeLag) {
                setInterval(function () {
                    if (isErrorState) { return; }
                    checkSocket();
                    checkLag(realtime, realtimeLag);
                }, 3000);
            }

            socket.onerror = function (err) {
                if (isErrorState) { return; }
                if (!checkSocket()) { error(true, err); }
            };

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

            console.log('started');
        };
    };

    return module.exports;
});
