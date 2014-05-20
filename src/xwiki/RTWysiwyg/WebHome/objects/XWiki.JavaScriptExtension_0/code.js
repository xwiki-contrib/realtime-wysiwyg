;(function() {
    if (XWiki.contextaction != 'edit') { return; }
    if (typeof(Wysiwyg) !== 'object') { return; }

    // VELOCITY
    var WEBSOCKET_URL = "$services.websocket.getURL('realtime')";
    var USER = "$!xcontext.getUserReference()" || "xwiki:XWiki.XWikiGuest";
    var ALLOW_REALTIME = "Allow Realtime Collaboration"; // TODO(cjd): translate
    var JOIN_REALTIME = "Join Realtime Collaborative Session";
    var PATHS = {
      RTWysiwyg_WebHome_chainpad: "$doc.getAttachmentURL('chainpad.js')",
      RTWysiwyg_WebHome_realtime_wysiwyg: "$doc.getAttachmentURL('realtime-wysiwyg.js')",
      RTWysiwyg_WebHome_html_patcher: "$doc.getAttachmentURL('html-patcher.js')",
      RTWysiwyg_WebHome_rangy: "$doc.getAttachmentURL('rangy.js')",
      RTWysiwyg_ErrorBox: "$xwiki.getURL('RTWysiwyg.ErrorBox','jsx')" + '?minify=false'
    };
    // END_VELOCITY

    for (var path in PATHS) { PATHS[path] = PATHS[path].replace(/\.js$/, ('?cb='+new Date().getTime())); }
    require.config({paths:PATHS});

    // remove to debug
    //var console = { log:function() {} };

    var deps = [ 'RTWysiwyg_WebHome_realtime_wysiwyg' ];
    // start them loading...
    require(deps, function () {});

    document.observe('xwiki:wysiwyg:showWysiwyg', function(event) {
        require(deps, function (RTWysiwyg) {
            var userName = USER + '-' + String(Math.random()).substring(2);
            var channel = JSON.stringify(XWiki.currentDocument);
            // GWT is catching all of the errors.
            window.onerror = null;
            RTWysiwyg.start(userName, channel, WEBSOCKET_URL);
        });
    });
}());
