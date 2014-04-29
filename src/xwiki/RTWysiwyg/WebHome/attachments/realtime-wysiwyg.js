/* vim: set expandtab ts=4 sw=4: */
/*
 * You may redistribute this program and/or modify it under the terms of
 * the GNU Lesser General Public License as published by the Free Software
 * Foundation, either version 2.1 of the License, or (at your option) any
 * later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
define(function () {

    var module = { exports: {} };
    var PARANOIA = true;

    var drillDown = function (node)
    {
        while (node.childNodes[0]) { node = node.childNodes[0]; }
        return node;
    };

    var getNextSiblingDeep = function (node)
    {
        if (node.firstChild) { return node.firstChild; }
        if (node.nextSibling) { return node.nextSibling; }
        if (node.parentNode) { return node.parentNode.nextSibling; }
    };

    var getPreviousSiblingDeep = function (node)
    {
        if (node.previousSibling) {
            node = node.previousSibling;
            while (node.lastChild) { node = node.lastChild; }
            return node;
        }
        return node.parentNode;
    };

    var decendsFrom = function (maybeChild, maybeParent)
    {
        for (;;) {
            if (!maybeChild) { return false; }
            if (maybeChild === maybeParent) { return true; }
            maybeChild = maybeChild.parentNode;
        }
    };

    var getOuterHTML = function (node)
    {
        var html = node.outerHTML;
        if (html) { return html; }
        if (node.parentNode && node.parentNode.childNodes.length === 1) {
            return node.parentNode.innerHTML;
        }
        var div = document.createElement('div');
        div.appendChild(node.cloneNode(true));
        return div.innerHTML;
    };

    var nodeFromHTML = function (html)
    {
        var e = document.createElement('div');
        e.innerHTML = html;
        return e.childNodes[0];
    };

    // TODO(cjd): is it possible to have a <tag attrib="val>ue"> ?
    //            in chrome the answer is no.
    var tagWidth = function (nodeOuterHTML)
    {
        if (nodeOuterHTML.length < 2
            || nodeOuterHTML[1] === '!'
            || nodeOuterHTML[0] !== '<')
        {
            return 0;
        }
        return nodeOuterHTML.indexOf('>') + 1;
    };

    var getInnerHTML = function (node)
    {
        var html = node.innerHTML;
        if (html) { return html; }
        var outerHTML = getOuterHTML(node);
        var tw = tagWidth(outerHTML);
        if (!tw) { return outerHTML; }
        return outerHTML.substring(tw, outerHTML.lastIndexOf('</'));
    };

    var uniqueId = function () { return 'uid-'+(''+Math.random()).slice(2); };

    var offsetOfNodeOuterHTML = function (docText, node, dom, ifrWindow)
    {
        if (PARANOIA && getInnerHTML(dom) !== docText) { throw new Error(); }
        if (PARANOIA && !node) { throw new Error(); }

        // can't get the index of the outerHTML of the dom in a string with only the innerHTML.
        if (node === dom) { throw new Error(); }

        var content = getOuterHTML(node);
        var idx = docText.lastIndexOf(content);
        if (idx === -1) { throw new Error(); }

        if (idx !== docText.indexOf(content)) {
            var idTag = uniqueId();
            var span = ifrWindow.document.createElement('span');
            span.setAttribute('id', idTag);
            var spanHTML = '<span id="'+idTag+'"></span>';
            if (PARANOIA && spanHTML !== span.outerHTML) { throw new Error(); }

            node.parentNode.insertBefore(span, node);
            var newDocText = getInnerHTML(dom);
            idx = newDocText.lastIndexOf(spanHTML);
            if (idx === -1 || idx !== newDocText.indexOf(spanHTML)) { throw new Error(); }
            node.parentNode.removeChild(span);

            if (PARANOIA && getInnerHTML(dom) !== docText) { throw new Error(); }
        }

        if (PARANOIA && docText.indexOf(content, idx) !== idx) { throw new Error() }
        return idx;
    };

    var getNodeAtOffset = function (docText, offset, dom)
    {
        if (PARANOIA && dom.childNodes.length && docText !== dom.innerHTML) { throw new Error(); }
        if (offset < 0) { throw new Error(); }

        var idx = 0;
        for (var i = 0; i < dom.childNodes.length; i++) {
            var childOuterHTML = getOuterHTML(dom.childNodes[i]);
            if (PARANOIA && docText.indexOf(childOuterHTML, idx) !== idx) { throw new Error(); }
            if (i === 0 && idx >= offset) {
                return { node: dom, pos: 0 };
            }
            if (idx + childOuterHTML.length > offset) {
                var childInnerHTML = childOuterHTML;
                var tw = tagWidth(childOuterHTML);
                if (tw) {
                    childInnerHTML = childOuterHTML.substring(tw, childOuterHTML.lastIndexOf('</'));
                }
                if (offset - idx - tw < 0) {
                    if (offset - idx === 0) {
                        return { node: dom.childNodes[i], pos: 0 };
                    }
                    break;
                }
                return getNodeAtOffset(childInnerHTML, offset - idx - tw, dom.childNodes[i]);
            }
            idx += childOuterHTML.length;
        }

        if (dom.nodeName[0] === '#text') {
            if (offset > docText.length) { throw new Error(); }
            var beforeOffset = docText.substring(0, offset);
            if (beforeOffset.indexOf('&') > -1) {
                var tn = nodeFromHTML(beforeOffset);
                offset = tn.data.length;
            }
        } else {
            offset = 0;
        }

        return { node: dom, pos: offset };
    };


    var makeTextOperation = function(oldval, newval)
    {
        if (oldval === newval) { return; }

        var begin = 0;
        for (; oldval[begin] === newval[begin]; begin++) ;

        var end = 0;
        for (var oldI = oldval.length, newI = newval.length; oldval[--oldI] === newval[--newI]; end++) ;

        if (end >= oldval.length - begin) { end = oldval.length - begin; }
        if (end >= newval.length - begin) { end = newval.length - begin; }

        return {
            offset: begin,
            toRemove: oldval.length - begin - end,
            toInsert: newval.slice(begin, newval.length - end),
        };
    };

    var makeHTMLOperation = (function () {

        // Used exclusively for error checking
        var isVoidTag = function (tag)
        {
            var ix = tag.indexOf(' ');
            if (ix > -1) {
                tag = tag.substring(0, ix);
            }
            switch (tag) {
                case 'area':
                case 'base':
                case 'br':
                case 'col':
                case 'hr':
                case 'img':
                case 'input':
                case 'link':
                case 'meta':
                case 'param':
                case 'command':
                case 'keygen':
                case 'source':
                    return true;
            }
            return false;
        };

        var INIT_TAG = 'SHOULD NEVER HAPPEN';
        var getPreviousTagIndex = function (data, idx, offsetStack)
        {
            var lastTag = INIT_TAG;
            if (offsetStack.length > 1) {
                var lastOffset = offsetStack[offsetStack.length-1];
                // we add 2 because lastOffsets are always at the beginning of a </endtag>
                lastTag = data.substring(lastOffset+2, data.indexOf('>', lastOffset));
                if (lastTag === '') { throw new Error(); }
            }

            for (var i = 0;; i++) {
                if (idx === 0) {
                    idx--;
                } else {
                    idx = data.lastIndexOf('<', idx-1);
                }
                if (idx < 0) {
                    if (offsetStack.length === 1) {
                        return -1;
                    }
                    throw new Error();
                }
                if (data[idx+1] === '/') {
                    if (offsetStack[offsetStack.length-1] === idx) { throw new Error(); }
                    offsetStack.push(idx);
                    return idx;
                } else {
                    var tag = data.substring(idx+1, data.indexOf('>', idx));
                    var endOfTag = tag.indexOf(' ');
                    if (endOfTag > -1) { tag = tag.substring(0, endOfTag); }
                    if (tag === lastTag) {
                        offsetStack.pop();
                        return idx;
                    }
                    if (PARANOIA && !isVoidTag(tag)) { throw new Error(); }
                }
                if (i > 1000) { throw new Error("infiniloop"); }
            }
        };

        var makeHTMLOperation = function (oldval, newval)
        {
            var op = makeTextOperation(oldval, newval);
            if (!op) { return; }

            var end = op.offset + op.toRemove;

            i = 0;
            var begin = oldval.length;
            var lastEnd;
            var offsetStack = [oldval.length];
            do {
                lastEnd = offsetStack[offsetStack.length-1];
                begin = getPreviousTagIndex(oldval, begin, offsetStack);
                if (begin === -1) {
                    begin = 0;
                    lastEnd = oldval.length;
                    break;
                }
                if (i++ > 1000) { throw new Error(); }
            } while (!(offsetStack.length % 2)
                || begin > op.offset
                || lastEnd < end);

            var rend = oldval.length - lastEnd;

            var out = {
                offset: begin,
                toRemove: lastEnd - begin,
                toInsert: newval.slice(begin, newval.length - rend)
            };


            if (PARANOIA) {
                // simulate running the patch.
                var res = (oldval.substring(0, out.offset)
                    + out.toInsert
                    + oldval.substring(out.offset + out.toRemove));
                if (res !== newval) {
                    console.log(out);
                    console.log(oldval);
                    console.log(newval);
                    console.log(res);
                    throw new Error();
                }

                // check matching bracket count
                var removeText = oldval.substring(out.offset, out.offset + out.toRemove);
                if (((removeText).match(/</g) || []).length !==
                    ((removeText).match(/>/g) || []).length)
                {
                    throw new Error();
                }

                if (((out.toInsert).match(/</g) || []).length !==
                    ((out.toInsert).match(/>/g) || []).length)
                {
                    throw new Error();
                }
            }

            return out;
        };

        return function (oldval, newval) {
            try {
                return makeHTMLOperation(oldval, newval);
            } catch (e) {
                if (PARANOIA) { console.log(e); }
                return {
                    offset: 0,
                    toRemove: oldval.length,
                    toInsert: newval
                };
            }
        };

    })();

    var getRelocatedPosition = (function () {
        var recurse = function (newParent, oldParent, oldNode, oldOffset, backward)
        {
            var nodeHTML = getOuterHTML(oldNode);
            var newNodes = [];
            for (var nextNode = newParent; nextNode = getNextSiblingDeep(nextNode);) {
                if (getOuterHTML(nextNode) === nodeHTML) { newNodes.push(nextNode); }
            }
            if (newNodes.length !== 1) {
                // search forward looking for a matching node
                var nextSiblingDeep = getNextSiblingDeep(oldNode);
                if (nextSiblingDeep && decendsFrom(nextSiblingDeep, oldParent)) {
                    if (!backward) {
                        var relocated = recurse(newParent, oldParent, nextSiblingDeep, 0, 0);
                        if (relocated) {
                            relocated.node = getPreviousSiblingDeep(relocated.node);
                            relocated.pos = oldOffset;
                        }
                        return relocated;
                    }
                    // try a reverse search
                    var previousSiblingDeep = getPreviousSiblingDeep(oldNode);
                    if (previousSiblingDeep && decendsFrom(previousSiblingDeep, oldParent)) {
                        var relocated = recurse(newParent, oldParent, previousSiblingDeep, 0, 1);
                        if (relocated) {
                            relocated.node = getNextSiblingDeep(relocated.node);
                            relocated.pos = oldOffset;
                        }
                        return relocated;
                    }
                }
                // fail
                return;
            }

            return { node: newNodes[0], pos: oldOffset };
        };

        return function (newParent, oldParent, oldNode, oldOffset)
        {
            return (recurse(newParent, oldParent, oldNode, oldOffset, 0)
                || { node: newParent, pos: oldOffset });
        };
    })();

    var checkOffset = function (node, offset)
    {
        if (offset === 0) { return offset; }
        if (node.nodeName[0] === '#' && offset < node.length) { return offset; }
        return 0;
    };

    // We can't create a real range until the new parent is installed in the document
    // but we need the old range ot be in the document so we can do comparisons
    // so create a "pseudo" range instead.
    var getRelocatedPseudoRange = function (newParent, oldParent, range)
    {
        if (!range.startContainer) {
            throw new Error();
        }

        var newStart =
            getRelocatedPosition(newParent, oldParent, range.startContainer, range.startOffset);

        newStart.pos = checkOffset(newStart.node, newStart.pos);
        var newEnd = { node: newStart.node, pos: newStart.pos };
        if (range.endContainer) {
            if (range.endContainer === range.startContainer) {
                newEnd = newStart;
            } else {
                newEnd =
                    getRelocatedPosition(newParent, oldParent, range.endContainer, range.endOffset);
                newEnd.pos = checkOffset(newEnd.node, newEnd.pos);
            }
        }

        return { start: newStart, end: newEnd };
    };

    var replaceAllChildren = function (parent, newParent)
    {
        var c;
        while ((c = parent.firstChild)) {
            parent.removeChild(c);
        }
        while ((c = newParent.firstChild)) {
            newParent.removeChild(c);
            parent.appendChild(c);
        }
    };

    var getSelectedRange = function (rangy, ifrWindow, selection) {
        selection = selection || rangy.getSelection(ifrWindow);
        if (selection.rangeCount === 0) {
            return;
        }
        var range = selection.getRangeAt(0);
        range.backward = (selection.rangeCount === 1 && selection.isBackward());
        if (!range.startContainer) {
            throw new Error();
        }
        return range;
    };

    var applyHTMLOp = function (docText, op, dom, rangy, ifrWindow)
    {
        if (PARANOIA && docText !== dom.innerHTML) { throw new Error(); }

        var parent = getNodeAtOffset(docText, op.offset, dom).node;
        var htmlToRemove = docText.substring(op.offset, op.offset + op.toRemove);

        var parentInnerHTML;
        var indexOfInnerHTML;
        var localOffset;
        for (;;) {
            for (;;) {
                parentInnerHTML = parent.innerHTML;
                if (typeof(parentInnerHTML) !== 'undefined'
                    && parentInnerHTML.indexOf(htmlToRemove) !== -1)
                {
                    break;
                }
                if (parent === dom || !(parent = parent.parentNode)) { throw new Error(); }
            }

            var indexOfOuterHTML = 0;
            var tw = 0;
            if (parent !== dom) {
                indexOfOuterHTML = offsetOfNodeOuterHTML(docText, parent, dom, ifrWindow);
                tw = tagWidth(docText.substring(indexOfOuterHTML));
            }
            indexOfInnerHTML = indexOfOuterHTML + tw;

            localOffset = op.offset - indexOfInnerHTML;

            if (localOffset >= 0 && localOffset + op.toRemove <= parentInnerHTML.length) {
                break;
            }

            parent = parent.parentNode;
            if (!parent) { throw new Error(); }
        }

        if (docText.substr(indexOfInnerHTML, parentInnerHTML.length) !== parentInnerHTML) {
            throw new Error();
        }

        var newParentInnerHTML = (
            parentInnerHTML.substring(0, localOffset)
          + op.toInsert
          + parentInnerHTML.substring(localOffset + op.toRemove));

        // Create a temp container for holding the children of the parent node.
        // Once we've identified the new range, we'll return the nodes to the
        // original parent. This is because parent might be the <body> and we
        // don't want to destroy all of our event listeners.
        var babysitter = ifrWindow.document.createElement('div');
        babysitter.innerHTML = newParentInnerHTML;

        var range = getSelectedRange(rangy, ifrWindow);
        if (range && range.containsNode(parent, true)) {

            var pseudoRange = getRelocatedPseudoRange(babysitter, parent, range, rangy);
            range.detach();
            replaceAllChildren(parent, babysitter);
            var selection = rangy.getSelection(ifrWindow);
            var newRange = rangy.createRange();
            newRange.setStart(pseudoRange.start.node, pseudoRange.start.pos);
            newRange.setEnd(pseudoRange.end.node, pseudoRange.end.pos);
            selection.setSingleRange(newRange);
        } else {
            replaceAllChildren(parent, babysitter);
        }
    };

    /* Return whether the selection range has been "dirtied" and needs to be reloaded. */
    var applyTextOp = function (docText, op, dom, rangy, ifrWindow)
    {
        if (PARANOIA && docText !== dom.innerHTML) { throw new Error(); }

        var nap = getNodeAtOffset(docText, op.offset, dom);
        var textNode = nap.node;
        var offset = nap.pos;
        if (textNode.nodeName !== '#text') {
            throw new Error();
        }

        if (PARANOIA) {
            var napB = getNodeAtOffset(docText, op.offset + op.toRemove, dom);
            if (napB.node !== nap.node) {
                throw new Error();
            }
        }

        var oldHTML = getOuterHTML(textNode);
        var newHTML = (
            oldHTML.substring(0,offset)
          + op.toInsert
          + oldHTML.substring(offset + op.toRemove));

        var range = getSelectedRange(rangy, ifrWindow);
        if (!range || (range.startContainer !== textNode && range.endContainer !== textNode)) {
            // fast path
            textNode.data = (newHTML === '') ? '' : nodeFromHTML(newHTML).data;
            return;
        }

        var oldText = textNode.textContent;
        textNode.data = (newHTML === '') ? '' : nodeFromHTML(newHTML).data;
        var newText = textNode.textContent;

        // do this again because the text might have escaped html crap
        // in it which we'd need to account for.
        var textOp = makeTextOperation(oldText, newText);
        var getNewOffset = function (cont, os) {
            if (cont !== textNode) { return os; }
            if (os > textOp.offset) {
                if (os <= textOp.offset + textOp.toRemove) {
                    return textOp.offset;
                }
                return os + textOp.toInsert.length - textOp.toRemove;
            }
            return os;
        };

        var rangeB = rangy.createRange();
        rangeB.setStart(range.startContainer, getNewOffset(range.startContainer, range.startOffset));
        rangeB.setEnd(range.endContainer, getNewOffset(range.endContainer, range.endOffset));

        var selection = rangy.getSelection(ifrWindow);
        selection.setSingleRange(rangeB);

        return;
    };

    /* Return whether the selection range has been "dirtied" and needs to be reloaded. */
    var applyOp = function (docText, op, dom, rangy, ifrWindow)
    {
        if (PARANOIA && docText !== dom.innerHTML) { throw new Error(); }

        if (op.offset + op.toRemove > docText.length) {
            throw new Error();
        }
        if (docText.substring(op.offset, op.offset + op.toRemove).indexOf('<') > -1
            || op.toInsert.indexOf('<') > -1 || true) // XXX:
        {
            return applyHTMLOp(docText, op, dom, rangy, ifrWindow);
        } else {
            return applyTextOp(docText, op, dom, rangy, ifrWindow);
        }
    };



    // ------------------ Trapping Keyboard Events ---------------------- //

    var bindEvents = function (element, events, callback, unbind) {
        for (var i = 0; i < events.length; i++) {
            var e = events[i];
            if (element.addEventListener) {
                if (unbind) {
                    element.removeEventListener(e, callback, false);
                } else {
                    element.addEventListener(e, callback, false);
                }
            } else {
                if (unbind) {
                    element.detachEvent('on' + e, callback);
                } else {
                    element.attachEvent('on' + e, callback);
                }
            }
        }
    };

    var bindAllEvents = function (wysiwygDiv, docBody, onEvent, unbind)
    {
        bindEvents(docBody,
                   ['textInput', 'keydown', 'keyup', 'select', 'cut', 'paste'],
                   onEvent,
                   unbind);
        bindEvents(wysiwygDiv,
                   ['mousedown','mouseup','click'],
                   onEvent,
                   unbind);
    };

    var start = module.exports.start = function (ChainPad, userName, channel, rangy, sockUrl) {
        var passwd = 'y';
        var wysiwygDiv = document.getElementsByClassName('xRichTextEditor')[0];
        var ifr = wysiwygDiv.getElementsByClassName('gwt-RichTextArea')[0];
        var doc = ifr.contentWindow.document;
        var socket = new WebSocket(sockUrl);
        socket.onerror = function (e) { console.log('socket error ' + e); };
        socket.onopen = function(evt) {
            var oldDocText = doc.body.innerHTML;
            var oldDocElem = document.createElement('div');
            oldDocElem.innerHTML = oldDocText;

            var conf = {
                atomicSectionMarkers: {
                    begin: '<',
                    end: '>'
                }
            };
            realtime = ChainPad.create(userName, passwd, channel, oldDocText, conf);
            var onEvent = function () {

    //            var userDoc = realtime.getUserDoc();
    //            if (userDoc !== oldDocText) { throw new Error(); }

                var docText = doc.body.innerHTML;
                if (oldDocText === docText) { return; }

                // chrome sometimes generates invalid html
                var docElemHTML = (function () {
                    var docElem = doc.createElement('div');
                    docElem.innerHTML = docText;
                    return docElem.innerHTML;
                })();
                var fixChromeOp = makeHTMLOperation(docText, docElemHTML);
                if (fixChromeOp) {
                    applyOp(docText,
                            fixChromeOp,
                            doc.body,
                            rangy,
                            ifr.contentWindow);
                    docText = doc.body.innerHTML;
                    if (docElemHTML !== docText) { throw new Error(); }
                }

                var op = makeHTMLOperation(oldDocText, docText);

                if (op.toRemove > 0) {
                    realtime.remove(op.offset, op.toRemove);
                }
                if (op.toInsert.length > 0) {
                    realtime.insert(op.offset, op.toInsert);
                }

                oldDocText = docText;
                if (realtime.getUserDoc() !== docText) { throw new Error(); }
            };

            var incomingPatch = function (patch) {

                var docText = doc.body.innerHTML;
                //if (oldDocText !== doc.body.innerHTML) { throw new Error(); }
                var rtDoc = realtime.getUserDoc();
                if (docText === rtDoc) { return; }
                var op = makeHTMLOperation(docText, rtDoc);
                applyOp(docText, op, doc.body, rangy, ifr.contentWindow);
                oldDocText = doc.body.innerHTML;

                /*while (realtime.getUserDoc() !== oldDocText) {
                    oldDocText = realtime.getUserDoc();
                    onEvent();
                    oldDocText = doc.body.innerHTML;
                }*/
            };

            socket.onmessage = function (evt) {
                // paranoia
                onEvent();
                realtime.message(evt.data);
            };
            realtime.onMessage(function (message) { 
                socket.send(message);
            });

            realtime.onPatch(incomingPatch);

            bindAllEvents(wysiwygDiv, doc.body, onEvent, false);

            setInterval(function () {
                // reconnect if the iframe changes...
                if (ifr === document.getElementsByClassName('gwt-RichTextArea')[0]) { return; }
                bindAllEvents(wysiwygDiv, doc.body, onEvent, true);
                wysiwygDiv = document.getElementsByClassName('xRichTextEditor')[0];
                ifr = wysiwygDiv.getElementsByClassName('gwt-RichTextArea')[0];
                doc = ifr.contentWindow.document;
                bindAllEvents(wysiwygDiv, doc.body, onEvent, false);
                onEvent();
            }, 200);

            realtime.start();

            console.log('started');
        };
    };


    return module.exports;
});
