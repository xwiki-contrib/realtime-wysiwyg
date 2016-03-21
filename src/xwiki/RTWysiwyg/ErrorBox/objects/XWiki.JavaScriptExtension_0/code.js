define(function () {
    var module = { exports: {} };

    // VELOCITY
    var PAGE_CONTENT = "$escapetool.javascript($doc.getRenderedContent())";
    // END VELOCITY

    /** different types of popups, see RTWysiwyg.ErrorBox content */
    var ELEMS = [ 'error', 'disconnected', 'debug', 'renderbug' ];

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


    var pageElem = document.createElement('div');
    pageElem.innerHTML = PAGE_CONTENT;
    var elems = {};
    for (var i = 0; i < ELEMS.length; i++) {
        elems[ELEMS[i]] = pageElem.getElementsByClassName('realtime-wysiwyg-' + ELEMS[i])[0];
    }

    var show = module.exports.show = function (type, wysiwygContent, internalData) {

        new ModalPopup({ then: function (elem) {
            for (var name in elems) {
                if (type !== name) { continue; }
                elem.appendChild(elems[name]);
                var con = elem.getElementsByClassName('wysiwygContent')[0];
                if (con) { con.value = wysiwygContent; }
                var data = elem.getElementsByClassName('internalData')[0];
                if (data) { data.value = internalData; }
                return;
            }
            elem.textContent = "error of unknown type ["+type+"]";
        }});
    };

    return module.exports;
});
