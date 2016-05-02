;(function() {
    // VELOCITY
    var WEBSOCKET_URL = "$!services.websocket.getURL('realtimeNetflux')";
    var USER = "$!xcontext.getUserReference()" || "xwiki:XWiki.XWikiGuest";
    var PRETTY_USER = "$xwiki.getUserName($xcontext.getUser(), false)";
    var DEMO_MODE = "$!request.getParameter('demoMode')" || false;
    var DEFAULT_LANGUAGE = "$xwiki.getXWikiPreference('default_language')";
    var LOCALSTORAGE_DISALLOW = 'rtwysiwyg-disallow';
    var MESSAGES = {
        allowRealtime: "Allow Realtime Collaboration", // TODO: translate
        joinSession: "Join Realtime Collaborative Session",

        wysiwygSessionInProgress: "A Realtime <strong>WYSIWYG</strong> Editor session is in progress:",

        disconnected: "Disconnected",
        myself: "Myself",
        guest: "Guest",
        guests: "Guests",
        and: "and",
        editingWith: "Editing With:",
        debug: "Debug",
        lag: "Lag:"
    };
    #set ($document = $xwiki.getDocument('RTFrontend.WebHome'))
    var PATHS = {
        RTWysiwyg_WebHome_realtime_netflux: "$doc.getAttachmentURL('realtime-wysiwyg.js')",
        RT_toolbar: "$doc.getAttachmentURL('toolbar.js')",
        RTWysiwyg_ErrorBox: "$xwiki.getURL('RTWysiwyg.ErrorBox','jsx')" + '?minify=false',

        RTFrontend_chainpad: "$document.getAttachmentURL('chainpad.js')",
        RTFrontend_realtime_input: "$document.getAttachmentURL('realtime-input.js')",

        RTFrontend_saver: "$document.getAttachmentURL('saver.js')",
        RTFrontend_interface: "$document.getAttachmentURL('interface.js')",

        RTFrontend_cursor: "$document.getAttachmentURL('cursor.js')",
        RTFrontend_json_ot: "$document.getAttachmentURL('json-ot.js')",

        RTFrontend_hyperjson: "$document.getAttachmentURL('hyperjson.js')",
        RTFrontend_hyperscript: "$document.getAttachmentURL('hyperscript.js')",

        RTFrontend_diffDOM: "$document.getAttachmentURL('diffDOM.js')",

        RTFrontend_treesome: "$document.getAttachmentURL('treesome.js')",
        RTFrontend_messages: "$document.getAttachmentURL('messages.js')",
        RTFrontend_promises: "$document.getAttachmentURL('es6-promise.min.js')",
        'json.sortify': "$document.getAttachmentURL('JSON.sortify.js')",
        RTFrontend_netflux: "$document.getAttachmentURL('netflux-client.js')",
        RTFrontend_text_patcher: "$document.getAttachmentURL('TextPatcher.js')",
        RTFrontend_tests: "$document.getAttachmentURL('TypingTests.js')",
        RTFrontend_rangy: "$document.getAttachmentURL('rangy-core.min.js')",

        RTFrontend_GetKey: "$xwiki.getURL('RTFrontend.GetKey','jsx')"
    };
    #if("$!doc.getObject('RTWysiwyg.ConfigurationClass').issueTrackerUrl" != "")
    var ISSUE_TRACKER_URL = "$!doc.getObject('RTWysiwyg.ConfigurationClass').issueTrackerUrl";
    #else
    #set($mainWIkiRef = $services.model.createDocumentReference($xcontext.getMainWikiName(), 'RTWysiwyg', 'WebHome'))
    var ISSUE_TRACKER_URL = "$!xwiki.getDocument($mainWIkiRef).getObject('RTWysiwyg.ConfigurationClass').issueTrackerUrl";
    #end
    // END_VELOCITY

    if (!WEBSOCKET_URL) {
        // TODO integrate this notification into the CKEditor upper panel
        console.log("The provided websocketURL was empty, aborting attempt to" +
            "configure a realtime session.");
        return;
    }

    var wiki = encodeURIComponent(XWiki.currentWiki);
    var space = encodeURIComponent(XWiki.currentSpace);
    var page = encodeURIComponent(XWiki.currentPage);
    PATHS.RTFrontend_GetKey = PATHS.RTFrontend_GetKey.replace(/\.js$/, '')+'?minify=false&wiki=' + wiki + '&space=' + space + '&page=' + page;

    for (var path in PATHS) { PATHS[path] = PATHS[path].replace(/\.js$/, ''); }
    //for (var path in PATHS) { PATHS[path] = PATHS[path] + '?cb='+(new Date()).getTime(); }
    require.config({paths:PATHS});

    if (!window.XWiki) {
        console.log("WARNING: XWiki js object not defined.");
        return;
    }

    // Not in edit mode?
    if (!DEMO_MODE && window.XWiki.contextaction !== 'edit') { return; }


    var getDocLock = function () {
        var force = document.querySelectorAll('a[href*="force=1"][href*="/edit/"]');
        return force.length? force[0] : false;
    };

    var usingCK = function () {
        /*  we can't rely on XWiki.editor to give an accurate response,
            nor can we expect certain scripts or stylesheets to exist

            if your document has CKEditor in its title it will have a cannonical
            link that will cause a false positive.

            http://jira.xwiki.org/browse/CKEDITOR-46 provides hooks, but these
            will not exist in older versions of XWiki.
        */
        return (/sheet=CKEditor/.test(window.location.href));
    };

    // used to insert some descriptive text before the lock link
    var prependLink = function (link, text) {
        var p = document.createElement('p');
        p.innerHTML = text;
        link.parentElement.insertBefore(p, link);
    };

    var pointToRealtime = function (link) {
        var href = link.getAttribute('href');

        href = href.replace(/\?(.*)$/, function (all, args) {
            return '?' + args.split('&').filter(function (arg) {
                if (arg === 'editor=wysiwyg') { return false; }
                if (arg === 'editor=wiki') { return false; }
                if (arg === 'sheet=CKEditor.EditSheet') { return false; }
                if (arg === 'force=1') { return false; }
            }).join('&');
        });

        href = href + '&editor=inline&sheet=CKEditor.EditSheet&force=1';
        link.setAttribute('href', href);
        link.innerText = MESSAGES.joinSession;

        prependLink(link, MESSAGES.wysiwygSessionInProgress);
    };

    var makeConfig = function () {
        var languageSelector = document.querySelectorAll('form input[name="language"]');// [0].value;

        var language = languageSelector[0] && languageSelector[0].value;

        if (!language || language === 'default') { language = DEFAULT_LANGUAGE; }

        // Username === <USER>-encoded(<PRETTY_USER>)%2d<random number>
        var userName = USER + '-' + encodeURIComponent(PRETTY_USER + '-').replace(/-/g, '%2d') +
            String(Math.random()).substring(2);

        return {
            websocketURL: WEBSOCKET_URL,
            userName: userName,
            language: language,
            channel: JSON.stringify([
                XWiki.currentWiki,
                XWiki.currentSpace,
                XWiki.currentPage,
                language,
                'rtwysiwyg'
            ])
        };
    };

    var checkSocket = function (config, callback) {
        var socket = new WebSocket(config.websocketURL);
        socket.onopen = function (evt) {
            var state = 0;
            var userCount = 0;
            var uid;
            socket.onmessage = function (evt) {
                var msg = JSON.parse(evt.data);
                if(state === 0 && msg[2] === "IDENT") {
                    uid = msg[3];
                    var joinMsg = [1, "JOIN", config.channel];
                    socket.send(JSON.stringify(joinMsg));
                    state = 1;
                    return;
                }
                if(state === 1 && msg[1] === "JACK" && msg[2] === config.channel) {
                    state = 2;
                    return;
                }
                if(state === 2 && msg[2] === "JOIN" && msg[3] === config.channel) {
                    if(msg[1] ===  uid) {
                        // If no other user : create the RT channel
                        if(userCount === 0) {
                            socket.close();
                            callback(false);
                        }
                        // If there is at least one user in the channel
                        else {
                            socket.close();
                            callback(true);
                        }
                        return;
                    }
                    // Count only users with a 32 chars name. The history keeper is a fake user with a 16 chars name.
                    userCount += (msg[1].length === 32) ? 1 : 0;
                }
            };
        };
    };

    var launchRealtime = function (config) {
        require(['jquery', 'RTWysiwyg_WebHome_realtime_netflux'], function ($, RTWysiwyg) {
            if (RTWysiwyg && RTWysiwyg.main) {
                RTWysiwyg.main(config.websocketURL, config.userName, MESSAGES, config.channel, DEMO_MODE, config.language);
                // Begin : Add the issue tracker icon
              var untilThen = function () {
                var iframe = $('iframe');
                if (window.CKEDITOR &&
                    window.CKEDITOR.instances &&
                    window.CKEDITOR.instances.content &&
                    iframe.length &&
                    iframe[0].contentWindow &&
                    iframe[0].contentWindow.body) {
                    if(ISSUE_TRACKER_URL && ISSUE_TRACKER_URL.trim() !== '') {
                      $('#cke_1_toolbox').append('<span id="RTWysiwyg_issueTracker" class="cke_toolbar" role="toolbar"><span class="cke_toolbar_start"></span><span class="cke_toolgroup"><a href="'+ISSUE_TRACKER_URL+'" target="_blank" class="cke_button cke_button_off" title="Report a bug" tabindex="-1" hidefocus="true" role="button" aria-haspopup="false"><span style="font-family: FontAwesome;cursor:default;" class="fa fa-bug"></span></a></span><span class="cke_toolbar_end"></span></span>');
                    }

                  });
                    // CKEditor seems to create IDs dynamically, and as such
                    // you cannot rely on IDs for removing buttons after launch
                    $('.cke_button__source').remove();
                    return;
                }
                setTimeout(untilThen, 100);
              };
              /* wait for the existence of CKEDITOR before doing things...  */
              untilThen();
              // End issue tracker icon
            } else {
                console.error("Couldn't find RTWysiwyg.main, aborting");
            }
        });
    };

    var realtimeDisallowed = function () {
        return localStorage.getItem(LOCALSTORAGE_DISALLOW)?  true: false;
    };
    var lock = getDocLock();

    var config = makeConfig();
    if (lock) {
        // found a lock link

        //console.log("Found a lock on the document!");
        checkSocket(config, function (active) {
            // determine if it's a realtime session
            if (active) {
                console.log("Found an active realtime");
                if (realtimeDisallowed()) {
                    // do nothing
                } else {
                    pointToRealtime(lock);
                }
            } else {
                console.log("Couldn't find an active realtime session");
            }
        });
    } else if (usingCK()) {
        // using CKEditor and realtime is allowed: start the realtime
        launchRealtime(config);
    } else {
        // do nothing
    }
}());
