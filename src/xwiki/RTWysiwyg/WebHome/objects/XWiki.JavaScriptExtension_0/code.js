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
    #foreach($e in $services.extension.installed.getInstalledExtensions())
        #if ($e.toString().contains("rtwysiwyg"))
            var extVersion = "$e.toString().split('/').get(1)";
        #end
    #end
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

    for (var path in PATHS) {
        PATHS[path] = PATHS[path].replace(/\.js$/, '');
        PATHS[path] += (PATHS[path].indexOf('?') === -1 ? '?' : '&') + 'v=' + extVersion;
    }
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
        href: defaultCk ? '&editor=wysiwyg&force=1&realtime=1' : '&editor=inline&sheet=CKEditor.EditSheet&force=1&realtime=1',
        name: "WYSIWYG",
        compatible: ['wysiwyg', 'wiki']
    };

    var $saveButton = $('#mainEditArea').find('input[name="action_saveandcontinue"]');
    var createRtCalled = false;
    var createRt = function () {
        if (createRtCalled) { return; }
        createRtCalled = true;
        if ($saveButton.length) {
            $saveButton.click();
            var onSaved = function () {
                window.location.href = Loader.getEditorURL(window.location.href, info);
            };
            document.observe('xwiki:document:saved', onSaved);
            document.observe('xwiki:document:saveFailed', function () {
                setTimeout(function () {
                    $saveButton.click();
                }, 2000);
            });
        }
    };
    Loader.setAvailableRt('wysiwyg', info, createRt);

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

    var updateKeys = function (cb) {
        var config = Loader.getConfig();
        var keysData = getKeyData(config);
        Loader.getKeys(keysData, function(keysResultDoc) {
            var keys = parseKeyData(config, keysResultDoc);
            cb(keys);
        });
    };

    var whenCkReady = function (cb) {
        var iframe = $('iframe');
        if (window.CKEDITOR &&
          window.CKEDITOR.instances &&
          window.CKEDITOR.instances.content &&
          iframe.length &&
          iframe[0].contentWindow &&
          iframe[0].contentWindow.body) {
            return void cb();
        }
        setTimeout(function () {
            whenCkReady(cb);
        }, 100);
    };
    var launchRealtime = function (config, keys, realtime) {
        require(['jquery', 'RTWysiwyg_WebHome_realtime_netflux'], function ($, RTWysiwyg) {
            if (RTWysiwyg && RTWysiwyg.main) {
                keys._update = updateKeys;
                RTWysiwyg.main(config, keys, realtime);
                // Begin : Add the issue tracker icon
                whenCkReady(function () {
                    if(ISSUE_TRACKER_URL && ISSUE_TRACKER_URL.trim() !== '') {
                        $('#cke_1_toolbox').append('<span id="RTWysiwyg_issueTracker" class="cke_toolbar" role="toolbar"><span class="cke_toolbar_start"></span><span class="cke_toolgroup"><a href="'+ISSUE_TRACKER_URL+'" target="_blank" class="cke_button cke_button_off" title="Report a bug" tabindex="-1" hidefocus="true" role="button" aria-haspopup="false"><span style="font-family: FontAwesome;cursor:default;" class="fa fa-bug"></span></a></span><span class="cke_toolbar_end"></span></span>');
                    }

                    var editor = window.CKEDITOR.instances.content;
                    RTWysiwyg.currentMode = editor.mode;

                    //$('.cke_button__source').remove();
                    $('.cke_button__source').click(function() {
                        // We need to stop autosaving
                        window.lastSaved.wasEditedLocally = false;
                        console.log("Editor mode: " + editor.mode);
                        if (RTWysiwyg.currentMode==="source") {
                            var checkSourceChange = setInterval(function() {
                                console.log("Check source tab closing");
                                var iframe = jQuery('iframe')[0];
                                if (editor.mode!=="source" &&
                                  iframe && iframe.contentWindow &&
                                  iframe.contentWindow.body) {
                                    console.log("Ready to update realtime");
                                    clearInterval(checkSourceChange);
                                    RTWysiwyg.currentMode = editor.mode;
                                    // when coming back to wysiwyg we need to make realtime 
                                    // pick up the changes. This code is still experimental.
                                    window.lastSaved.wasEditedLocally = true;
                                    REALTIME_MODULE.realtimeOptions.onLocalFromSource();
                                }
                            }, 100);
                        } else {
                            RTWysiwyg.currentMode = "source";
                        }
                    });
                    return;
                });
                // End issue tracker icon
            } else {
                console.error("Couldn't find RTWysiwyg.main, aborting");
            }
        });
    };

    var lockCk = function () {
        var iframe = jQuery('iframe')[0];
        var inner = iframe.contentWindow.body;
        inner.setAttribute('contenteditable', false);
    };
    var unlockCk = function () {
        var iframe = jQuery('iframe')[0];
        var inner = iframe.contentWindow.body;
        inner.setAttribute('contenteditable', true);
    };

    if (lock) {
        // found a lock link : check active sessions
        Loader.checkSessions(info);
    } else if (usingCK() || DEMO_MODE) {
        var todo = function (keys, needRt) {
            if (!needRt) {
                var config = Loader.getConfig();
                config.rtURL = Loader.getEditorURL(window.location.href, info);
                return void launchRealtime(config, keys);
            }
            var done = false;
            whenCkReady(function () {
                if (done) { return; }
                setTimeout(lockCk);
            });
            Loader.whenReady(function (wsAvailable) {
                done = true;
                var config = Loader.getConfig();
                config.rtURL = Loader.getEditorURL(window.location.href, info);
                // 3rd argument is "enable realtime"
                Loader.isRt = wsAvailable;
                if (!wsAvailable) { setTimeout(unlockCk); }
                launchRealtime(config, keys, wsAvailable || 0);
            });
        };
        updateKeys(function (keys) {
            if(!keys.rtwysiwyg || !keys.events || !keys.userdata) {
                ErrorBox.show('unavailable');
                console.error("You are not allowed to create a new realtime session for that document.");
            }
            var realtime = /*keys.rtwysiwyg_users > 0 || */Loader.isRt;
            if (Object.keys(keys.active).length > 0) {
                // Should only happen when there is a realtime session with another editor (wiki, inline...)
                if (keys.rtwysiwyg_users > 0) {
                    todo(keys, realtime);
                } else {
                    var callback = function() {
                        todo(keys, true);
                    };
                    console.log("Join the existing realtime session or create a new one");
                    Loader.displayModal("rtwysiwyg", Object.keys(keys.active), callback, info);
                }
            } else {
                todo(keys, realtime);
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
        } else if(lock) {
            var button = new Element('button', {'class': 'btn btn-primary'});
            var br =  new Element('br');
            button.insert(Loader.messages.redirectDialog_create.replace(/\{0\}/g, "Wysiwyg"));
            var buttons = $('.realtime-buttons');
            buttons.append(br).append(button);
            var modal = buttons.data('modal');
            $(button).on('click', function() {
                //modal.closeDialog();
                buttons.find('button').hide();
                var waiting = $('<div>', {style:'text-align:center;'}).appendTo(buttons);
                waiting.append($('<span>', {
                    'class': 'fa fa-spinner fa-2x fa-spin',
                    style: 'vertical-align: middle'
                }));
                waiting.append($('<span>', {
                    style: 'vertical-align: middle'
                }).text(Loader.messages.waiting));
                var autoForce = $('<div>').appendTo(buttons);
                var i = 60;
                var it = setInterval(function () {
                    i--;
                    autoForce.html('<br>' + Loader.messages.redirectDialog_autoForce + i + "s");
                    if (i <= 0) {
                        clearInterval(it);
                        window.location.href = Loader.getEditorURL(window.location.href, info);
                    }
                }, 1000);
                Loader.requestRt('wysiwyg', function (state) {
                    // We've received an answer
                    clearInterval(it);
                    if (state === false || state === 2) {
                        // false: Nobody in the channel
                        // 2: Rt should already exist
                        console.error(state === false ? "EEMPTY" : "EEXISTS"); // FIXME
                        window.location.href = Loader.getEditorURL(window.location.href, info);
                        return;
                    }
                    if (state === 1) {
                        // Accepted
                        var whenReady = function (cb) {
                            updateKeys(function (k) {
                                if (k.rtwysiwyg_users > 0) { return void cb(); }
                                setTimeout(function () {
                                    whenReady(cb);
                                }, 1000);
                            });
                        };
                        whenReady(function () {
                            var i = {href: defaultCk ? '&editor=wysiwyg' : '&editor=inline&sheet=CKEditor.EditSheet'};
                            window.location.href = Loader.getEditorURL(window.location.href, i);
                        });
                        return;
                    }
                });
            });
        }
    };
    displayButtonModal();
    $(document).on('insertButton', displayButtonModal);
});
})();
