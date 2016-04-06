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
    'RTWysiwyg_WebHome_messages',
    'RTWysiwyg_WebHome_reconnecting_websocket',
    'RTWysiwyg_WebHome_toolbar',
    'RTWysiwyg_WebHome_text_patcher',
    'RTWysiwyg_WebHome_chainpad',
    'jquery',
], function (Messages, ReconnectingWebSocket, Toolbar, TextPatcher) {

    var $ = window.jQuery;
    var ChainPad = window.ChainPad;
    var PARANOIA = true;
    var module = { exports: {} };

    /**
     * If an error is encountered but it is recoverable, do not immediately fail
     * but if it keeps firing errors over and over, do fail.
     */
    var MAX_RECOVERABLE_ERRORS = 15;

    /** Maximum number of milliseconds of lag before we fail the connection. */
    var MAX_LAG_BEFORE_DISCONNECT = 20000;

    var debug = function (x) { console.log(x); },
        warn = function (x) { console.error(x); },
        verbose = function (x) {
            if (window.verboseLogging) { console.log(x); }
        };

    /* websocket stuff */
    var isSocketDisconnected = function (socket, realtime) {
        var sock = socket._socket;
        return sock.readyState === sock.CLOSING
            || sock.readyState === sock.CLOSED
            || (realtime.getLag().waiting && realtime.getLag().lag > MAX_LAG_BEFORE_DISCONNECT);
    };

    // this differs from other functions with similar names in that
    // you are expected to pass a socket into it.
    var checkSocket = function (socket) {
        if (isSocketDisconnected(socket, socket.realtime) &&
            !socket.intentionallyClosing) {
            return true;
        } else {
            return false;
        }
    };

    // TODO before removing websocket implementation
    // bind abort to onLeaving
    var abort = function (socket, realtime) {
        realtime.abort();
        try { socket._socket.close(); } catch (e) { warn(e); }
    };

    var handleError = function (socket, realtime, err, docHTML, allMessages) {
        // var internalError = createDebugInfo(err, realtime, docHTML, allMessages);
        abort(socket, realtime);
    };

    var makeWebsocket = function (url) {
        try {
            var socket = new ReconnectingWebSocket(url);
        } catch (err) {
            console.log("Unable to initialize the websocket. Aborting...");
            console.error(err);
            return false;
        }
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
                    if (out[name][i](evt) === false) {
                        console.log(name +"Handler");
                        return;
                    }
                }
            };
        };
        socket.onopen = mkHandler('onOpen');
        socket.onclose = mkHandler('onClose');
        socket.onerror = mkHandler('onError');
        socket.onmessage = mkHandler('onMessage');
        return out;
    };
    /* end websocket stuff */

    var start = module.exports.start = function (config) {
        // TODO test for a falsey websocketURL and complain
        var websocketUrl = config.websocketURL;

        var userName = config.userName;
        var channel = config.channel;

        // TODO this is unused, remove
        var cryptKey = config.cryptKey;

        var passwd = 'y';

        var transformFunction = config.transformFunction || null;

        var socket = makeWebsocket(websocketUrl);

        if (!socket) {
            // The websocket failed to initialize. Abort.
            config.onAbort({
                error: "Socket failed to initialize",
                initError: true
            });
            return;
        }

        var allMessages = [];
        var isErrorState = false;
        var initializing = true;
        var recoverableErrorCount = 0;

        var toReturn = {};

        socket.onOpen.push(function (evt) {
            // FIXME I'm not clear on why this is here
            // for being able to restart the session without reloading
            if (!initializing) {
                debug("Starting");
                // realtime is passed around as an attribute of the socket
                // FIXME??
                socket.realtime.start();
                return;
            }

            var realtime = socket.realtime = toReturn.realtime = ChainPad.create(userName,
                                passwd,
                                channel,
                                config.initialState,
                                {
                                    transformFunction: config.transformFunction
                                });

            if (config.onInit) {
                // extend as you wish
                config.onInit({
                    realtime: realtime
                });
            }

            var onEvent = toReturn.onEvent = function (newText) {
                // This looks broken
                if (isErrorState || initializing) { return; }
                if (realtime.getUserDoc() !== newText) {
                    warn("realtime.getUserDoc() !== newText");
                }
            };

            realtime.onUserListChange(function (userList) {
                if (!initializing || userList.indexOf(userName) === -1) {
                    if (config.onUserListChange) {
                        config.onUserListChange({
                            userList: userList,
                            realtime: realtime
                        });
                    }
                    return;
                }
                // if we spot ourselves being added to the document, we'll switch
                // 'initializing' off because it means we're fully synced.
                initializing = false;

                // execute an onReady callback if one was supplied
                // pass an object so we can extend this later
                if (config.onReady) {
                    // extend as you wish
                    config.onReady({
                        userList: userList,
                        realtime: realtime
                    });
                }
            });

            realtime.onPatch(function () {
                if (config.onRemote) {
                    config.onRemote({
                        realtime: realtime
                    });
                }
            });

            // when you receive a message...
            socket.onMessage.push(function (evt) {
                verbose(evt.data);
                if (isErrorState) { return; }

                var message = evt.data;
                allMessages.push(message);
                if (!initializing) {
                    if (toReturn.onLocal) {
                        toReturn.onLocal();
                    }
                }
                realtime.message(message);
            });

            // when a message is ready to send
            realtime.onMessage(function (message) {
                if (isErrorState) { return; }
                try {
                    socket.send(message);
                } catch (e) {
                    warn(e);
                }
            });

            // actual socket bindings
            socket.onmessage = function (evt) {
                for (var i = 0; i < socket.onMessage.length; i++) {
                    if (socket.onMessage[i](evt) === false) { return; }
                }
            };
            socket.onclose = function (evt) {
                for (var i = 0; i < socket.onMessage.length; i++) {
                    if (socket.onClose[i](evt) === false) { return; }
                }
            };

            socket.onerror = warn;

            var socketChecker = setInterval(function () {
                if (checkSocket(socket)) {
                    warn("Socket disconnected!");

                    recoverableErrorCount += 1;

                    if (recoverableErrorCount >= MAX_RECOVERABLE_ERRORS) {
                        warn("Giving up!");
                        abort(socket, realtime);
                        if (config.onAbort) {
                            config.onAbort({
                                socket: socket
                            });
                        }
                        if (socketChecker) { clearInterval(socketChecker); }
                    }
                } else {
                    // it's working as expected, continue
                }
            }, 200);

            /*  Formerly this was accomplished with sharejs_textarea
                Relying on events to propogate through CKEditor and then
                through a textarea, then ChainPad added an unnecessary step
                patchText cuts out the middleman.

                Export the patchText function, and pass in your current state
                of the document you intend to synchronize. patchText will diff
                it and put the patches into ChainPad */
            toReturn.patchText = TextPatcher.create({
                realtime: realtime
            });

            realtime.start();
            debug('started');

            toReturn.abort = function () {
                abort(socket, realtime);
                if (config.onAbort) {
                    config.onAbort({
                        socket: socket
                    });
                }
            };
        });

        return toReturn;
    };
    return module.exports;
});
