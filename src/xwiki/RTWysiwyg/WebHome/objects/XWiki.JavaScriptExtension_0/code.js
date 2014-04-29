;(function() {
    if (XWiki.contextaction != 'edit') { return; }
    if (typeof(Wysiwyg) !== 'object') { return; }

    // VELOCITY
    var WEBSOCKET_URL = "$services.websocket.getURL('realtime')";
    var USER = "$services.model.resolveDocument($xcontext.getUser())";
    var ALLOW_REALTIME = "Allow Realtime Collaboration"; // TODO(cjd): translate
    var JOIN_REALTIME = "Join Realtime Collaborative Session";
    var PATHS = {
      RTWysiwyg_WebHome_chainpad: "$doc.getAttachmentURL('chainpad.js')",
      RTWysiwyg_WebHome_realtime_wysiwyg: "$doc.getAttachmentURL('realtime-wysiwyg.js')",
      RTWysiwyg_WebHome_rangy: "$doc.getAttachmentURL('rangy.js')"
    };
    // END_VELOCITY

    for (var path in PATHS) { PATHS[path] = PATHS[path].replace(/\.js$/, ''); }
    require.config({paths:PATHS});

    // remove to debug
    //var console = { log:function() {} };

    var deps = [
        'RTWysiwyg_WebHome_realtime_wysiwyg',
        'RTWysiwyg_WebHome_rangy',
        'RTWysiwyg_WebHome_chainpad',
    ];
    // start them loading...
    require(deps, function () {});

    document.observe('xwiki:wysiwyg:showWysiwyg', function(event) {
        require(deps, function (RTWysiwyg) {
            var userName = USER + '-' + String(Math.random()).substring(2);
            var channel = JSON.stringify(XWiki.currentDocument);
            window.rangy.init();
            // GWT is catching all of the errors.
            window.onerror = null;
            RTWysiwyg.start(window.ChainPad, userName, channel, window.rangy, WEBSOCKET_URL);
        });
    });
}());
