var DEMO_MODE = "$!request.getParameter('demoMode')" || false;
DEMO_MODE = (DEMO_MODE === true || DEMO_MODE === "true") ? true : false;
var path = "$xwiki.getURL('RTFrontend.LoadEditors','jsx')" + '?minify=false&demoMode='+DEMO_MODE;
var pathErrorBox = "$xwiki.getURL('RTFrontend.ErrorBox','jsx')" + '?';
require([path, pathErrorBox], function(Loader, ErrorBox) {
    // VELOCITY
    #set ($document = $xwiki.getDocument('RTWysiwyg.WebHome'))
    var PATHS = {
        RTWysiwyg_WebHome_realtime_netflux: "$document.getAttachmentURL('realtime-wysiwyg.js')",
    };
    #if("$!doc.getObject('RTWysiwyg.ConfigurationClass').issueTrackerUrl" != "")
    var ISSUE_TRACKER_URL = "$!doc.getObject('RTWysiwyg.ConfigurationClass').issueTrackerUrl";
    #else
    #set($mainWIkiRef = $services.model.createDocumentReference($xcontext.getMainWikiName(), 'RTWysiwyg', 'WebHome'))
    var ISSUE_TRACKER_URL = "$!xwiki.getDocument($mainWIkiRef).getObject('RTWysiwyg.ConfigurationClass').issueTrackerUrl";
    #end
    // END_VELOCITY

    for (var path in PATHS) { PATHS[path] = PATHS[path].replace(/\.js$/, ''); }
    require.config({paths:PATHS});

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

    var launchRealtime = function (config, keys) {
        require(['jquery', 'RTWysiwyg_WebHome_realtime_netflux'], function ($, RTWysiwyg) {
            if (RTWysiwyg && RTWysiwyg.main) {
                RTWysiwyg.main(config, keys);
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

    var getDocLock = function () {
        var force = document.querySelectorAll('a[href*="force=1"][href*="/edit/"]');
        return force.length? force[0] : false;
    };
    var lock = getDocLock();

    var info = {
        type: 'rtwysiwyg',
        href: '&editor=inline&sheet=CKEditor.EditSheet&force=1',
        name: "WYSIWYG"
    };

    if (lock) {
        // found a lock link : check active sessions
        Loader.checkSessions(info);
    } else if (usingCK() || DEMO_MODE) {
        var config = Loader.getConfig();
        var keysData = [
            {doc: config.reference, mod: config.language+'/events', editor: "1.0"},
            {doc: config.reference, mod: config.language+'/content', editor: "rtwysiwyg"}
        ];
        Loader.getKeys(keysData, function(keysResultDoc) {
            var keys = {};
            var keysResult = keysResultDoc[config.reference];
            if(keysResult[config.language+'/events'] && keysResult[config.language+'/events']["1.0"] &&
               keysResult[config.language+'/content'] && keysResult[config.language+'/content']["rtwysiwyg"]) {
                keys.rtwysiwyg = keysResult[config.language+'/content']["rtwysiwyg"].key;
                keys.events = keysResult[config.language+'/events']["1.0"].key;
            }
            if(keys.rtwysiwyg && keys.events) {
                launchRealtime(config, keys);
            }
            else {
                var type = (Object.keys(keys).length === 1) ? Object.keys(keys)[0] : null;
                if(type) {
                    Loader.displayModal(type, info);
                    console.error("You are not allowed to create a new realtime session for that document. Active session : "+Object.keys(keys));
                    console.log("Join that realtime editor if you want to edit this document");
                }
                else {
                    ErrorBox.show('unavailable');
                    console.error("You are not allowed to create a new realtime session for that document.");
                }
            }
        });
    }
});
