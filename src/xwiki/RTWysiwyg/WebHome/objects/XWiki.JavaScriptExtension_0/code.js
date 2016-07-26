(function() {
var DEMO_MODE = "$!request.getParameter('demoMode')" || false;
DEMO_MODE = (DEMO_MODE === true || DEMO_MODE === "true") ? true : false;
// Not in edit mode?
if (!DEMO_MODE && window.XWiki.contextaction !== 'edit') { return false; }
var path = "$xwiki.getURL('RTFrontend.LoadEditors','jsx')" + '?minify=false&demoMode='+DEMO_MODE;
var pathErrorBox = "$xwiki.getURL('RTFrontend.ErrorBox','jsx')" + '?';
require([path, pathErrorBox, 'jquery'], function(Loader, ErrorBox, $) {
    if(!Loader) { return; }
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

    // XWiki >= 8.2?
    var isUsingDefaultCK = function () {
        // Get the wiki version
        var v= [];
        if ("$!xwiki.version".length) {
            v = "$xwiki.version".split(".");
        }

        // Is that a valid XWiki version?
        if (v.length < 2) { return false; }
        // XWiki major version should be at least 8
        if (parseInt(v[0]) < 8) { return false; }
        // XWiki >= 8.2 (exclude RC and milestone versions)
        if (parseInt(v[1]).toString() !== v[1] && parseInt(v[1]) === 2) { return false; }
        if (parseInt(v[1]) < 2) { return false; }

        return true;
    }

    var defaultCk = isUsingDefaultCK();

    var usingCK = function () {
        /*  we can't rely on XWiki.editor to give an accurate response,
            nor can we expect certain scripts or stylesheets to exist

            if your document has CKEditor in its title it will have a cannonical
            link that will cause a false positive.

            http://jira.xwiki.org/browse/CKEDITOR-46 provides hooks, but these
            will not exist in older versions of XWiki.
        */

        return ( /sheet=CKEditor/.test(window.location.href) ||
                  (defaultCk && window.XWiki.editor === 'wysiwyg') );
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

    var getWysiwygLock = function () {
        var selector = 'a[href*="editor=inline"][href*="sheet=CKEditor.EditSheet"][href*="force=1"][href*="/edit/"]';
        if (defaultCk) {
            selector = 'a[href*="editor=wysiwyg"][href*="force=1"][href*="/edit/"]';
        }
        var force = document.querySelectorAll(selector);
        return force.length? true : false;
    };

    var lock = Loader.getDocLock();
    var wysiwygLock = getWysiwygLock();

    var info = {
        type: 'rtwysiwyg',
        href: defaultCk ? '&editor=wysiwyg&force=1' : '&editor=inline&sheet=CKEditor.EditSheet&force=1',
        name: "WYSIWYG"
    };

    var getKeyData = function(config) {
        return [
            {doc: config.reference, mod: config.language+'/events', editor: "1.0"},
            {doc: config.reference, mod: config.language+'/events', editor: "userdata"},
            {doc: config.reference, mod: config.language+'/content',editor: "rtwysiwyg"}

        ];
    };

    var parseKeyData = function(config, keysResultDoc) {
        var keys = {};
        var keysResult = keysResultDoc[config.reference];
        if (!keysResult) { console.error("Unexpected error with the document keys"); return keys; }

        var keysResultContent = keysResult[config.language+'/content'];
        if (!keysResultContent) { console.error("Missing content keys in the document keys"); return keys; }

        var keysResultEvents = keysResult[config.language+'/events'];
        if (!keysResultEvents) { console.error("Missing event keys in the document keys"); return keys; }

        if (keysResultContent.rtwysiwyg && keysResultEvents["1.0"] && keysResultEvents["userdata"]) {
            keys.rtwysiwyg = keysResultContent.rtwysiwyg.key;
            keys.rtwysiwyg_users = keysResultContent.rtwysiwyg.users;
            keys.events = keysResultEvents["1.0"].key;
            keys.userdata = keysResultEvents["userdata"].key;
        }
        else { console.error("Missing mandatory RTWysiwyg key in the document keys"); return keys; }

        var activeKeys = keys.active = {};
        for (var key in keysResultContent) {
            if (key !== "rtwysiwyg" && keysResultContent[key].users > 0) {
                activeKeys[key] = keysResultContent[key];
            }
        }
        return keys;
    };

    if (lock) {
        // found a lock link : check active sessions
        Loader.checkSessions(info);
    } else if (usingCK() || DEMO_MODE) {
        var config = Loader.getConfig();
        var keysData = getKeyData(config);
        Loader.getKeys(keysData, function(keysResultDoc) {
            var keys = parseKeyData(config, keysResultDoc);
            if(!keys.rtwysiwyg || !keys.events || !keys.userdata) {
                ErrorBox.show('unavailable');
                console.error("You are not allowed to create a new realtime session for that document.");
            }
            if (Object.keys(keys.active).length > 0) {
                if (keys.rtwysiwyg_users > 0 || Loader.isForced) {
                    launchRealtime(config, keys);
                } else {
                    var callback = function() {
                        launchRealtime(config, keys);
                    };
                    console.log("Join the existing realtime session or create a new one");
                    Loader.displayModal("rtwysiwyg", Object.keys(keys.active), callback, info);
                }
            } else {
                launchRealtime(config, keys);
            }
        });
    }

    var displayButtonModal = function() {
        if ($('.realtime-button-rtwysiwyg').length) {
            var button = new Element('button', {'class': 'btn btn-success'});
            var br =  new Element('br');
            button.insert(Loader.messages.redirectDialog_join.replace(/\{0\}/g, "Wysiwyg"));
            $('.realtime-button-rtwysiwyg').prepend(button);
            $('.realtime-button-rtwysiwyg').prepend(br);
            $(button).on('click', function() {
                window.location.href = Loader.getEditorURL(window.location.href, info);
            });
        } else if(lock && wysiwygLock) {
            var button = new Element('button', {'class': 'btn btn-primary'});
            var br =  new Element('br');
            button.insert(Loader.messages.redirectDialog_create.replace(/\{0\}/g, "Wysiwyg"));
            $('.realtime-buttons').append(br);
            $('.realtime-buttons').append(button);
            $(button).on('click', function() {
                window.location.href = Loader.getEditorURL(window.location.href, info);
            });
        }
    };
    displayButtonModal();
    $(document).on('insertButton', displayButtonModal);
});
})();
