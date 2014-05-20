define(function () {
    var module = { exports: {} };

    // VELOCITY
    var PAGE_CONTENT = "$escapetool.javascript($doc.getRenderedContent())";
    // END VELOCITY

    var pageElem = document.createElement('div');
    pageElem.innerHTML = PAGE_CONTENT;
    var errorElem = pageElem.getElementsByClassName('realtime-wysiwyg-error')[0];
    var disconnectedElem = pageElem.getElementsByClassName('realtime-wysiwyg-disconnected')[0];

    var ModalPopup = Class.create(XWiki.widgets.ModalPopup, {
        /** Default parameters can be added to the custom class. */
        defaultInteractionParameters : {
        },

        /** Constructor. Registers the key listener that pops up the dialog. */
        initialize : function($super, interactionParameters) {
            this.interactionParameters =
                Object.extend(Object.clone(this.defaultInteractionParameters),
                                           interactionParameters || {});

            // call constructor from ModalPopup with params content, shortcuts, options
            $super(this.createContent(this.interactionParameters), {
                    "show"  : { method : this.showDialog,  keys : [] },
                    "close" : { method : this.closeDialog, keys : ['Esc'] }
                },
                {
                    displayCloseButton : true,
                    verticalPosition : "top",
                    backgroundColor : "#FFF"
                }
            );
            this.showDialog();
        },

        /** Get the content of the modal dialog using ajax */
        createContent : function (data) {
            var elem = new Element('div', {'class': 'modal-popup'});
            setTimeout(function () { data.then(elem); }, 0);
            return elem;
        }
    });

    var show = module.exports.show = function (type, wysiwygContent, internalData) {
        new ModalPopup({ then: function (elem) {
            if (type === 'error') {
                elem.appendChild(errorElem);
                elem.getElementsByClassName('wysiwygContent')[0].value = wysiwygContent;
                elem.getElementsByClassName('internalData')[0].value = internalData;
            } else if (type === 'disconnected') {
                elem.appendChild(disconnectedElem);
                elem.getElementsByClassName('wysiwygContent')[0].value = wysiwygContent;
            } else {
                console.log("error of unknown type");
            }
        }});
    };

    return module.exports;
});
