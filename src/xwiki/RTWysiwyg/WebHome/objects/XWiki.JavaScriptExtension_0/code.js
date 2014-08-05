;(function() {
    // VELOCITY
    var WEBSOCKET_URL = "$!services.websocket.getURL('realtime')";
    var USER = "$!xcontext.getUserReference()" || "xwiki:XWiki.XWikiGuest";
    var PRETTY_USER = "$xwiki.getUserName($xcontext.getUser(), false)";
    var DEMO_MODE = "$!request.getParameter('demoMode')" || false;
    var DEFAULT_LANGUAGE = "$xwiki.getXWikiPreference('default_language')";
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
        RTWysiwyg_WebHome_html_patcher: "$doc.getAttachmentURL('html-patcher.js')",
        RTWysiwyg_WebHome_rangy: "$doc.getAttachmentURL('rangy.js')",
        RTWysiwyg_WebHome_otaml: "$doc.getAttachmentURL('otaml.js')",
        RTWysiwyg_ErrorBox: "$xwiki.getURL('RTWysiwyg.ErrorBox','jsx')" + '?minify=false'
    };
    // END_VELOCITY

    for (var path in PATHS) { PATHS[path] = PATHS[path].replace(/\.js$/, ''); }
    require.config({paths:PATHS});

    if (!window.XWiki) {
        console.log("WARNING: XWiki js object not defined.");
        return;
    }

    // Not in edit mode?
    if (!DEMO_MODE && window.XWiki.contextaction !== 'edit') { return; }

    // Username === <USER>-encoded(<PRETTY_USER>)%2d<random number>
    var userName = USER + '-' + encodeURIComponent(PRETTY_USER + '-').replace(/-/g, '%2d') +
        String(Math.random()).substring(2);

    require(['jquery', 'RTWysiwyg_WebHome_realtime_wysiwyg'], function () { });

    document.observe('xwiki:wysiwyg:showWysiwyg', function(event) {
        require(['jquery', 'RTWysiwyg_WebHome_realtime_wysiwyg'], function ($, RTWysiwyg) {

            // GWT is catching all of the errors.
            window.onerror = null;

            var language = $('form#edit input[name="language"]').attr('value');
            if (language === '' || language === 'default') { language = DEFAULT_LANGUAGE; }

            var channel = JSON.stringify([
                XWiki.currentWiki,
                XWiki.currentSpace,
                XWiki.currentPage,
                language,
                'rtwysiwyg'
            ]);

            RTWysiwyg.main(WEBSOCKET_URL, userName, MESSAGES, channel, DEMO_MODE, language);

        });
    });

}());
