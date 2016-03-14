;(function() {
    // VELOCITY
    var WEBSOCKET_URL = "$!services.websocket.getURL('realtime')";
    var USER = "$!xcontext.getUserReference()" || "xwiki:XWiki.XWikiGuest";
    var PRETTY_USER = "$xwiki.getUserName($xcontext.getUser(), false)";
    var DEMO_MODE = "$!request.getParameter('demoMode')" || false;
    var DEFAULT_LANGUAGE = "$xwiki.getXWikiPreference('default_language')";
    var LOCALSTORAGE_DISALLOW = 'rtwysiwyg-disallow';
    var MESSAGES = {
        allowRealtime: "Allow Realtime Collaboration", // TODO: translate
        joinSession: "Join Realtime Collaborative Session",

        disconnected: "Disconnected",
        myself: "Myself",
        guest: "Guest",
        guests: "Guests",
        and: "and",
        editingWith: "Editing With:",
        debug: "Debug",
        lag: "Lag:"
    };
    var PATHS = {
        RTWysiwyg_WebHome_chainpad: "$doc.getAttachmentURL('chainpad.js')",
        RTWysiwyg_WebHome_realtime_wysiwyg: "$doc.getAttachmentURL('realtime-wysiwyg.js')",
        RTWysiwyg_WebHome_realtime_cleartext: "$doc.getAttachmentURL('realtime-cleartext.js')",

        // RTWysiwyg_WebHome_convert: "$doc.getAttachmentURL('convert.js')",
        RTWysiwyg_WebHome_toolbar: "$doc.getAttachmentURL('toolbar.js')",
        RTWysiwyg_WebHome_cursor: "$doc.getAttachmentURL('cursor.js')",
        RTWysiwyg_WebHome_json_ot: "$doc.getAttachmentURL('json-ot.js')",

        RTWysiwyg_WebHome_hyperjson: "$doc.getAttachmentURL('hyperjson.js')",
        RTWysiwyg_WebHome_hyperscript: "$doc.getAttachmentURL('hyperscript.js')",

        RTWysiwyg_WebHome_treesome: "$doc.getAttachmentURL('treesome.js')",
        RTWysiwyg_WebHome_sharejs_textarea: "$doc.getAttachmentURL('sharejs_textarea.js')",

        RTWysiwyg_WebHome_diffDOM: "$doc.getAttachmentURL('diffDOM.js')",

        RTWysiwyg_WebHome_messages: "$doc.getAttachmentURL('messages.js')",
        RTWysiwyg_WebHome_reconnecting_websocket: "$doc.getAttachmentURL('reconnecting-websocket.js')",

        RTWysiwyg_WebHome_rangy: "$doc.getAttachmentURL('rangy-core.min.js')",
        RTWysiwyg_ErrorBox: "$xwiki.getURL('RTWysiwyg.ErrorBox','jsx')" + '?minify=false'
    };
    // END_VELOCITY

    //for (var path in PATHS) { PATHS[path] = PATHS[path].replace(/\.js$/, ''); }
    for (var path in PATHS) { PATHS[path] = PATHS[path] + '?cb='+(new Date()).getTime(); }
    require.config({paths:PATHS});

    if (!window.XWiki) {
        console.log("WARNING: XWiki js object not defined.");
        return;
    }

    // Not in edit mode?
    if (!DEMO_MODE && window.XWiki.contextaction !== 'edit') { return; }


    // TODO more reliably test if we're using CKEditor
    // XWiki.editor might be 'inline', which is probably no good.
    var usingCK = function () {
        var editor = window.XWiki.editor;
        if (document.querySelectorAll('link[href*="CKEditor"],'+
            ' script[src*="CKEditor"]').length) {
            console.log("CKEditor detected, loading realtime WYSIWYG code...");
            return true;
        }
        //href='/xwiki/bin/ssx/CKEditor/EditSheet?language=en'
        //if (editor === 'inline') { return true; }
    };

    if (!usingCK()) {
        console.log("Not using CKEditor. Aborting RTWysiwyg code");
        return;
    }

    //var hasDisallowed 

    var hasActiveRealtimeSession = function () {
        console.log("Checking if there is an active realtime session");

        var force = document.querySelectorAll('a[href*="force=1"][href*="/edit/"]');
        var href, link;
        if (force.length /*&& !LOCALSTORAGE_DISALLOW*/  ) {
            link = force[0];

            link.textContent = MESSAGES.joinSession;
            href = link.getAttribute('href');

            href = href.replace(/editor=(wiki|inline)[\&]?/, '') +
                    'editor=inline&sheet=CKEditor.EditSheet&force=1';

            link.setAttribute('href', href);
            console.log("Corrected link to: %s", href);
            return true;
        }
        return false;
    };

    if (hasActiveRealtimeSession()) {
        console.log("realtime session found");
        return;
    } else {
        console.log("No active realtime session found");
    }

    // Username === <USER>-encoded(<PRETTY_USER>)%2d<random number>
    var userName = USER + '-' + encodeURIComponent(PRETTY_USER + '-').replace(/-/g, '%2d') +
        String(Math.random()).substring(2);

    // nested requires...
    require(['jquery', 'RTWysiwyg_WebHome_realtime_wysiwyg'], function ($, RTWysiwyg) {
/*      // GWT is catching all of the errors.
        window.onerror = null; */

        var language = $('form#edit input[name="language"]').attr('value');
        if (language === '' || language === 'default') { language = DEFAULT_LANGUAGE; }

        var channel = JSON.stringify([
            XWiki.currentWiki,
            XWiki.currentSpace,
            XWiki.currentPage,
            language,
            'rtwysiwyg'
        ]);

        // FIXME don't invoke main unless it exists
        // watch out, this gets minified, so you're going to break if the API doesn't match

        if (RTWysiwyg && RTWysiwyg.main) {
            RTWysiwyg.main(WEBSOCKET_URL, userName, MESSAGES, channel, DEMO_MODE, language);
        } else {
            console.error("Couldn't find RTWysiwyg.main, aborting");
        }
    });
}());
