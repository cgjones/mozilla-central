/* -*- Mode: javascript; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

var EXPORTED_SYMBOLS = ["ElementManager"];

var uuidGen = Components.classes["@mozilla.org/uuid-generator;1"]
             .getService(Components.interfaces.nsIUUIDGenerator);
var timer = Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer);

var CLASS_NAME = "class name";
var SELECTOR = "css selector";
var ID = "id";
var NAME = "name";
var LINK_TEXT = "link text";
var PARTIAL_LINK_TEXT = "partial link text";
var TAG = "tag name";
var XPATH = "xpath";
var elementStrategies = [CLASS_NAME, SELECTOR, ID, NAME, LINK_TEXT, PARTIAL_LINK_TEXT, TAG, XPATH];

function ElementException(msg, num, stack) {
  this.message = msg;
  this.num = num;
  this.stack = stack;
}

function ElementManager() {
  this.searchTimeout = 0;
  this.seenItems = {};
}

ElementManager.prototype = {
  /**
  * Add element to list of seen elements
  */
  reset: function EM_clear() {
    this.searchTimeout = 0;
    this.seenItems = {};
  },

  addToKnownElements: function EM_addToKnownElements(element) {
    for (var i in this.seenItems) {
      if (this.seenItems[i] == element) {
        return i;
      }
    }
    var id = uuidGen.generateUUID().toString();
    this.seenItems[id] = element;
    return id;
  },
  
  /**
   * Check if the element is still in the document
   */
  inDocument: function EM_inDocument(element, win) { 
    while (element) {
        if (element == win.document) {
            return true;
        }
        element = element.parentNode;
    }
    return false;
  },
  
  /**
   * Retrieve element from its unique ID
   */
  getKnownElement: function EM_getKnownElement(id, win) {
    var el = this.seenItems[id];
    if (!el) {
     // sendError("Element has not been seen before", 17, null);
      //return 17;
      throw new ElementException("Element has not been seen before", 17, null);
    }
    else if (!this.inDocument(el, win)) {
      //sendError("Stale element reference", 10, null);
      //return 10;
      throw new ElementException("Stale element reference", 10, null);
    //  return null;
    }
    return el;
  },
  
  /**
   * Convert values to primitives that can be transported over the Marionette
   * JSON protocol.
   */
  wrapValue: function EM_wrapValue(val) {
    var result;
    switch(typeof(val)) {
      case "undefined":
        result = null;
        break;
      case "string":
      case "number":
      case "boolean":
        result = val;
        break;
      case "object":
        if (Object.prototype.toString.call(val) == '[object Array]') {
          result = [];
          for (var i in val) {
            result.push(this.wrapValue(val[i]));
          }
        }
        else if (val == null) {
          result = null;
        }
        // nodeType 1 == 'element'
        else if (val.nodeType == 1) {
          for(var i in this.seenItems) {
            if (this.seenItems[i] == val) {
              result = {'ELEMENT': i};
            }
          }
          result = {'ELEMENT': this.addToKnownElements(val)};
        }
        else {
          result = {};
          for (var prop in val) {
            result[prop] = this.wrapValue(val[prop]);
          }
        }
        break;
    }
    return result;
  },
  
  /**
   * Convert any ELEMENT references in 'args' to the actual elements
   */
  convertWrappedArguments: function EM_convertWrappedArguments(args, win) {
    var converted;
    switch (typeof(args)) {
      case 'number':
      case 'string':
      case 'boolean':
        converted = args;
        break;
      case 'object':
        if (args == null) {
          converted = null;
        }
        else if (Object.prototype.toString.call(args) == '[object Array]') {
          converted = [];
          for (var i in args) {
            converted.push(this.convertWrappedArguments(args[i], win));
          }
        }
        else if (typeof(args['ELEMENT'] === 'string') &&
                 args.hasOwnProperty('ELEMENT')) {
          converted = this.getKnownElement(args['ELEMENT'],  win);
          if (converted == null)
            throw new ElementException("Unknown element: " + args['ELEMENT'], 500, null);
        }
        else {
          converted = {};
          for (var prop in args) {
            converted[prop] = this.convertWrappedArguments(args[prop], win);
          }
        }
        break;
    }
    return converted;
  },
  
  /*
   * Execute* helpers
   */
  
  /**
   * Apply any namedArgs to the Marionette object
   */
  applyNamedArgs: function EM_applyNamedArgs(args, marionette_obj) {
    marionette_obj.namedArgs = {};
    args.forEach(function(arg) {
      if (typeof(arg['__marionetteArgs']) === 'object') {
        for (var prop in arg['__marionetteArgs']) {
          marionette_obj.namedArgs[prop] = arg['__marionetteArgs'][prop];
        }
      }
    });
  },
  
  findElement: function EM_findElement(values, rootNode, notify) {
    var startTime = values.time ? values.time : new Date().getTime();
    if (elementStrategies.indexOf(values.using) < 0) {
      throw new ElementException("No such strategy.", 17, null);
    }
    var element;
    switch(values.using) {
      case ID:
        element = rootNode.getElementById(values.value);
        break;
      case NAME:
        element = rootNode.getElementsByName(values.value)[0];
        break;
      case CLASS_NAME:
        element = rootNode.getElementsByClassName(values.value)[0];
        break;
      case TAG:
        element = rootNode.getElementsByTagName(values.value)[0];
        break;
      case XPATH:
        element = rootNode.evaluate(values.value, rootNode, null,
                    Components.interfaces.nsIDOMXPathResult.FIRST_ORDERED_NODE_TYPE, null).
                    singleNodeValue;
        break;
      case LINK_TEXT:
      case PARTIAL_LINK_TEXT:
        var allLinks = rootNode.getElementsByTagName('A');
        for (var i = 0; i < allLinks.length && !element; i++) {
          var text = allLinks[i].text;
          if (PARTIAL_LINK_TEXT == values.using) {
            if (text.indexOf(values.value) != -1) {
              element = allLinks[i];
            }
          } else if (text == values.value) {
            element = allLinks[i];
          }
        }
        break;
      case SELECTOR:
        element = rootNode.querySelector(values.value);
        break;
      default:
        throw new ElementException("No such strategy", 500, null);
    }
    if (element) {
      var id = this.addToKnownElements(element);
      notify(id);
      return;
    } else {
      if (this.searchTimeout == 0 || new Date().getTime() - startTime > this.searchTimeout) {
        throw new ElementException("Unable to locate element: " + values.value, 7, null);
      } else {
        values.time = startTime;
        timer.initWithCallback(this.findElement.bind(this, values, rootNode, notify), 100, Components.interfaces.nsITimer.TYPE_ONE_SHOT);
      }
    }
  },
  
  /**
   * Sets the timeout for searching for elements with find element
   */
  setSearchTimeout: function EM_setSearchTimeout(value) {
    this.searchTimeout = parseInt(value);
    if(isNaN(this.searchTimeout)){
      throw new ElementException("Not a Number", 500, null);
    }
  },
}
