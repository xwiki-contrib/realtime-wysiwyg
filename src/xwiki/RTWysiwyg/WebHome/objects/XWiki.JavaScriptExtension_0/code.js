var DEMO_MODE = "$!request.getParameter('demoMode')" || false;
DEMO_MODE = (DEMO_MODE === true || DEMO_MODE === "true") ? true : false;
var path = "$xwiki.getURL('RTFrontend.LoadEditors','jsx')" + '?minify=false&demoMode='+DEMO_MODE;
require([path], function(Loader) {
    // VELOCITY
    #set ($document = $xwiki.getDocument('RTWysiwyg.WebHome'))
    var PATHS = {
        RTWysiwyg_WebHome_realtime_netflux: "$document.getAttachmentURL('realtime-wysiwyg.js')",
        RTWysiwyg_ErrorBox: "$xwiki.getURL('RTWysiwyg.ErrorBox','jsx')" + '?minify=false',
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

    var config = Loader.getConfig();

    var realtimeDisallowed = function () {
        return localStorage.getItem(config.LOCALSTORAGE_DISALLOW)?  true: false;
    };

    if (lock) {
        // found a lock link : check active sessions
        Loader.checkSessions();
    } else if (usingCK() || config.DEMO_MODE) {
        var config = Loader.getConfig();
        Loader.getKeys(['rtwysiwyg', 'events_rtwysiwyg'], function(keys) {
            launchRealtime(config, keys);
        });
    }
});
