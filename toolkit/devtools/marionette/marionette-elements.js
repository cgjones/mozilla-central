/* -*- Mode: javascript; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

var EXPORTED_SYMBOLS = ["ElementManager", "CLASS_NAME", "SELECTOR", "ID", "NAME", "LINK_TEXT", "PARTIAL_LINK_TEXT", "TAG", "XPATH"];

var uuidGen = Components.classes["@mozilla.org/uuid-generator;1"]
             .getService(Components.interfaces.nsIUUIDGenerator);

var CLASS_NAME = "class name";
var SELECTOR = "css selector";
var ID = "id";
var NAME = "name";
var LINK_TEXT = "link text";
var PARTIAL_LINK_TEXT = "partial link text";
var TAG = "tag name";
var XPATH = "xpath";

function ElementException(msg, num, stack) {
  this.message = msg;
  this.num = num;
  this.stack = stack;
}

function ElementManager(notSupported) {
  this.searchTimeout = 0;
  this.seenItems = {};
  this.timer = Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer);
  this.elementStrategies = [CLASS_NAME, SELECTOR, ID, NAME, LINK_TEXT, PARTIAL_LINK_TEXT, TAG, XPATH];
  for (var i = 0; i < notSupported.length; i++) {
    this.elementStrategies.splice(this.elementStrategies.indexOf(notSupported[i]), 1);
  }
}

ElementManager.prototype = {
  /**
   * Reset values
   */
  reset: function EM_clear() {
    this.searchTimeout = 0;
    this.seenItems = {};
  },

  /**
  * Add element to list of seen elements
  */
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
   * Return an object with any namedArgs applied to it.
   */
  applyNamedArgs: function EM_applyNamedArgs(args) {
    namedArgs = {};
    args.forEach(function(arg) {
      if (typeof(arg['__marionetteArgs']) === 'object') {
        for (var prop in arg['__marionetteArgs']) {
          namedArgs[prop] = arg['__marionetteArgs'][prop];
        }
      }
    });
    return namedArgs;
  },
  
  find: function EM_find(values, rootNode, notify, all) {
    var startTime = values.time ? values.time : new Date().getTime();
    if (this.elementStrategies.indexOf(values.using) < 0) {
      throw new ElementException("No such strategy.", 17, null);
    }
    var found = all ? this.findElements(values.using, values.value, rootNode) : this.findElement(values.using, values.value, rootNode);
    if (found) {
      var type = Object.prototype.toString.call(found);
      if ((type == '[object Array]') || (type == '[object HTMLCollection]')) {
        var ids = []
        for (var i = 0 ; i < found.length ; i++) {
          ids.push(this.addToKnownElements(found[i]));
        }
        notify(ids);
      }
      else {
        var id = this.addToKnownElements(found);
        notify(id);
      }
      return;
    } else {
      if (this.searchTimeout == 0 || new Date().getTime() - startTime > this.searchTimeout) {
        throw new ElementException("Unable to locate element: " + values.value, 7, null);
      } else {
        values.time = startTime;
        this.timer.initWithCallback(this.find.bind(this, values, rootNode, notify, all), 100, Components.interfaces.nsITimer.TYPE_ONE_SHOT);
      }
    }
  },
  
  findElement: function EM_findElement(using, value, rootNode) {
    var element;
    switch (using) {
      case ID:
        element = rootNode.getElementById(value);
        break;
      case NAME:
        element = rootNode.getElementsByName(value)[0];
        break;
      case CLASS_NAME:
        element = rootNode.getElementsByClassName(value)[0];
        break;
      case TAG:
        element = rootNode.getElementsByTagName(value)[0];
        break;
      case XPATH:
        element = rootNode.evaluate(value, rootNode, null,
                    Components.interfaces.nsIDOMXPathResult.FIRST_ORDERED_NODE_TYPE, null).
                    singleNodeValue;
        break;
      case LINK_TEXT:
      case PARTIAL_LINK_TEXT:
        var allLinks = rootNode.getElementsByTagName('A');
        for (var i = 0; i < allLinks.length && !element; i++) {
          var text = allLinks[i].text;
          if (PARTIAL_LINK_TEXT == using) {
            if (text.indexOf(value) != -1) {
              element = allLinks[i];
            }
          } else if (text == value) {
            element = allLinks[i];
          }
        }
        break;
      case SELECTOR:
        element = rootNode.querySelector(value);
        break;
      default:
        throw new ElementException("No such strategy", 500, null);
    }
    return element;
  },

  findElements: function EM_findElements(using, value, rootNode) {
    var elements = [];
    switch (using) {
      case ID:
        value = './/*[@id="' + value + '"]';
      case XPATH:
        values = rootNode.evaluate(value, rootNode, null,
                    Components.interfaces.nsIDOMXPathResult.ORDERED_NODE_ITERATOR_TYPE, null)
        var element = values.iterateNext();
        while (element) {
          elements.push(element);
          element = values.iterateNext();
        }
        break;
      case NAME:
        elements = rootNode.getElementsByName(value);
        break;
      case CLASS_NAME:
        elements = rootNode.getElementsByClassName(value);
        break;
      case TAG:
        elements = rootNode.getElementsByTagName(value);
        break;
      case LINK_TEXT:
      case PARTIAL_LINK_TEXT:
        var allLinks = rootNode.getElementsByTagName('A');
        for (var i = 0; i < allLinks.length; i++) {
          var text = allLinks[i].text;
          if (PARTIAL_LINK_TEXT == using) {
            if (text.indexOf(value) != -1) {
              elements.push(allLinks[i]);
            }
          } else if (text == value) {
            elements.push(allLinks[i]);
          }
        }
        break;
      case SELECTOR:
        elements = rootNode.querySelectorAll(value);
        break;
      default:
        throw new ElementException("No such strategy", 500, null);
    }
    return elements;
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
