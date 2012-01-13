/* -*- Mode: javascript; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ft=javascript ts=2 et sw=2 tw=80: */
/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is mozilla.org code.
 *
 * The Initial Developer of the Original Code is
 *   Mozilla Foundation
 * Portions created by the Initial Developer are Copyright (C) 2011
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *    Malini Das (mdas@mozilla.com)
 *    Jonathan Griffin (jgriffin@mozilla.com)
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

var Cu = Components.utils;
var uuidGen = Components.classes["@mozilla.org/uuid-generator;1"]
             .getService(Components.interfaces.nsIUUIDGenerator);

var loader = Components.classes["@mozilla.org/moz/jssubscript-loader;1"]
             .getService(Components.interfaces.mozIJSSubScriptLoader);
loader.loadSubScript("resource:///modules/marionette-simpletest.js");

var isB2G = false;

var CLASS_NAME = "class name";
var SELECTOR = "css selector";
var ID = "id";
var NAME = "name";
var LINK_TEXT = "link text";
var PARTIAL_LINK_TEXT = "partial link text";
var TAG = "tag name";
var XPATH = "xpath";
var elementStrategies = [CLASS_NAME, SELECTOR, ID, NAME, LINK_TEXT, PARTIAL_LINK_TEXT, TAG, XPATH];

var marionetteTimeout = null;
var marionetteSearchTimeout = 0; //implicit timeout while searching for items
var seenItems = {}; //holds the seen elements in content
var timer = Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer);

addMessageListener("Marionette:newSession", newSession);
addMessageListener("Marionette:executeScript", executeScript);
addMessageListener("Marionette:setScriptTimeout", setScriptTimeout);
addMessageListener("Marionette:executeAsyncScript", executeAsyncScript);
addMessageListener("Marionette:executeJSScript", executeJSScript);
addMessageListener("Marionette:setSearchTimeout", setSearchTimeout);
addMessageListener("Marionette:getUrl", getUrl);
addMessageListener("Marionette:goBack", goBack);
addMessageListener("Marionette:goForward", goForward);
addMessageListener("Marionette:refresh", refresh);
addMessageListener("Marionette:findElement", findElement);
addMessageListener("Marionette:clickElement", clickElement);
addMessageListener("Marionette:deleteSession", deleteSession);

function newSession(msg) {
  isB2G = msg.json.B2G;
  resetValues();
  let session='session' + (isB2G ? '-b2g' : '');
  sendResponse({value: session});
}

function deleteSession(msg) {
  removeMessageListener("Marionette:newSession", newSession);
  removeMessageListener("Marionette:executeScript", executeScript);
  removeMessageListener("Marionette:setScriptTimeout", setScriptTimeout);
  removeMessageListener("Marionette:executeAsyncScript", executeAsyncScript);
  removeMessageListener("Marionette:executeJSScript", executeJSScript);
  removeMessageListener("Marionette:setSearchTimeout", setSearchTimeout);
  removeMessageListener("Marionette:getUrl", getUrl);
  removeMessageListener("Marionette:goBack", goBack);
  removeMessageListener("Marionette:goForward", goForward);
  removeMessageListener("Marionette:refresh", refresh);
  removeMessageListener("Marionette:findElement", findElement);
  removeMessageListener("Marionette:clickElement", clickElement);
  removeMessageListener("Marionette:deleteSession", deleteSession);
}

/*
 * Helper methods 
 */ 
function sendResponse(value) {
  sendAsyncMessage("Marionette:done", value);
}

function sendOk() {
  sendAsyncMessage("Marionette:ok", {});
}

function sendLog(msg) {
  sendAsyncMessage("Marionette:log", { message: msg });
}

function sendError(message, status, trace) {
  var error_msg = { message: message, status: status, stacktrace: trace };
  sendAsyncMessage("Marionette:error", error_msg);
}

function resetValues() {
  marionetteTimeout = null;
  Marionette.tests = [];
}

/*
 * Web Element Helpers
 */

function addToKnownElements(element) {
  for (var i in seenItems) {
    if (seenItems[i] == element) {
      return i;
    }
  }
  var id = uuidGen.generateUUID().toString();
  seenItems[id] = element;
  return id;
}

function inDocument(element) { 
  while (element) {
      if (element == content.document) {
          return true;
      }
      element = element.parentNode;
  }
  return false;
}

function getKnownElement(id) {
  var el = seenItems[id];
  if (!el) {
    sendError("Element has not been seen before", 17, null);
    return null;
  }
  else if (!inDocument(el)) {
    sendError("Stale element reference", 10, null);
    return null;
  }
  return el;
}

function sendValue(val) {
  if (typeof val == "object") {
    if ('marionette_object' in val) {
      delete val['marionette_object'];
      return val;
    }
    for(var i in seenItems) {
      if (seenItems[i] == val) {
        return {'ELEMENT': i};
      }
    }
    return {'ELEMENT': addToKnownElements(val)};
  }
  else {
    return val;
  }
}

/*
 * Execute* helpers
 */

/* send error when we detect an unload event during async scripts */
function errUnload() {
  sendError("unload was called", 17, null);
}

/* upon completion or error from the async script, send response to marionette-responder */
function asyncResponse() {
  var window = content;
  window.removeEventListener("unload", errUnload, false);
  window.document.removeEventListener("marionette-async-response", asyncResponse, false);

  /* clear all timeouts potentially generated by the script*/
  var maxTimeoutId = window.document.getUserData('__marionetteTimeoutId');
  for(var i=0; i<=maxTimeoutId; i++) {
    window.clearTimeout(i);
  }

  var res = window.document.getUserData('__marionetteRes');
  if (res.status == 0){
    sendResponse({value: sendValue(res.value), status: res.status});
  }
  else {
    sendError(res.value, res.status, null);
  }
  Marionette.reset();
}

/*
 * Marionette Methods
 */

/* execute given script */
function executeScript(msg, directInject) {
  var script = msg.json.value;
  var args = msg.json.args; //TODO: handle WebElement JSON Objects
  for (var i in args) {
    if (args[i]["ELEMENT"] != undefined && args[i]["ELEMENT"] != null) {
      args[i] = getKnownElement(args[i]["ELEMENT"]);
      if (!args[i]) {
        return;
      }
    }
  }

  Marionette.is_async = false;
  Marionette.context = "content";

  var sandbox = new Cu.Sandbox(content);
  sandbox.window = content;
  sandbox.document = sandbox.window.document;
  sandbox.navigator = sandbox.window.navigator;
  sandbox.__marionetteParams = args;
  sandbox.__proto__ = sandbox.window;
  sandbox.Marionette = Marionette;
  try {
    if (directInject) {
      var res = Cu.evalInSandbox(script, sandbox);
      if (res == undefined || res.passed == undefined) {
        sendError("Marionette.finish() not called", 17, null);
      }
      else {
        sendResponse({value: sendValue(res)});
      }
    }
    else {
      var scriptSrc = "var __marionetteFunc = function(){" + script +
                    "};  __marionetteFunc.apply(null, __marionetteParams);";
      var res = Cu.evalInSandbox(scriptSrc, sandbox);
      sendResponse({value: sendValue(res)});
    }
  }
  catch (e) {
    // 17 = JavascriptException
    sendError(e.name + ': ' + e.message, 17, e.stack);
  }
  Marionette.reset();
}

/* function to set the timeout of asynchronous scripts */
function setScriptTimeout(msg) {
  marionetteTimeout = msg.json.value;
}

function executeAsyncScript(msg) {
  executeWithCallback(msg);
}

function executeJSScript(msg) {
  if (msg.json.timeout) {
    executeWithCallback(msg, msg.json.timeout);
  }
  else {
    executeScript(msg, true);
  }
}

/* execute given asynchronous script */
function executeWithCallback(msg, timeout) {
  content.addEventListener("unload", errUnload, false);
  var script = msg.json.value;
  var scriptSrc;
  var args = msg.json.args ? msg.json.args : [];
  //convert webelements
  for (var i in args) {
    if (args[i]["ELEMENT"] != undefined && args[i]["ELEMENT"] != null) {
      args[i] = getKnownElement(args[i]["ELEMENT"]);
      if (!args[i]) {
        return;
      }
    }
  }
  var timeoutSrc = "var timeoutId = window.setTimeout(Marionette.asyncComplete," + marionetteTimeout + ", 'timed out', 28);" + 
                   "window.document.setUserData('__marionetteTimeoutId', timeoutId, null);";
  if (timeout) {
    scriptSrc = script + timeoutSrc;
  }
  else {
    scriptSrc = "var marionetteScriptFinished = function(value) { return Marionette.asyncComplete(value,0);};" +
                  "__marionetteParams.push(marionetteScriptFinished);" +
                  "var __marionetteFunc = function() { " + script +
                  "};  __marionetteFunc.apply(null, __marionetteParams); " + 
                  timeoutSrc;
  }
  content.document.addEventListener("marionette-async-response", asyncResponse, false);

  Marionette.is_async = true;
  Marionette.context = "content";

  var sandbox = new Cu.Sandbox(content);
  sandbox.window = content;
  sandbox.document = sandbox.window.document;
  sandbox.timeoutId = null;
  sandbox.navigator = sandbox.window.navigator;
  sandbox.__marionetteParams = args;
  sandbox.document.setUserData("__marionetteRes", {}, null);
  sandbox.__proto__ = sandbox.window;
  sandbox.Marionette = Marionette;
  //TODO: odd. error code 28 is scriptTimeout, but spec says executeAsync should return code 21: Timeout...
  //and selenium code returns 28 (http://code.google.com/p/selenium/source/browse/trunk/javascript/firefox-driver/js/evaluate.js)
  try {
   Cu.evalInSandbox(scriptSrc, sandbox);
  } catch (e) {
    // 17 = JavascriptException
    sendError(e.name + ': ' + e.message, 17, e.stack);
  }
}

function setSearchTimeout(msg) {
  marionetteSearchTimeout = parseInt(msg.json.value);
  if(isNaN(marionetteTimeout)){
    sendError("Not a Number", 17, null);
  }
  else {
    sendOk();
  }
}

function getUrl(msg) {
  sendResponse({value: content.location.href});
}

function goBack(msg) {
  content.history.back();
  sendOk();
}

function goForward(msg) {
  content.history.forward();
  sendOk();
}

function refresh(msg) {
  content.location.reload(true);
  addEventListener("DOMContentLoaded", function() { removeEventListener("DOMContentLoaded", this, false); sendOk();}, false);
}

//Todo: extend to support findChildElement
function findElement(msg) {
  var startTime = msg.json.time ? msg.json.time : new Date().getTime();
  var rootNode = content.document;
  if (elementStrategies.indexOf(msg.json.using) < 0) {
    sendError("No such strategy", 17, null);
    return;
  }
  var element;
  switch(msg.json.using) {
    case ID:
      element = rootNode.getElementById(msg.json.value);
      break;
    case NAME:
      element = rootNode.getElementsByName(msg.json.value)[0];
      break;
    case CLASS_NAME:
      element = rootNode.getElementsByClassName(msg.json.value)[0];
      break;
    case TAG:
      element = rootNode.getElementsByTagName(msg.json.value)[0];
      break;
    default:
      sendError("Strategy not yet supported", 17, null);
  }
  if (element) {
    var id = addToKnownElements(element);
    sendResponse({value: id});
  } else {
    var wait = marionetteSearchTimeout;
    if (wait == 0 || new Date().getTime() - startTime > wait) {
      sendError("Unable to locate element: " + msg.json.value, 7, null);
    } else {
      msg.json.time = startTime;
      timer.initWithCallback(function() { findElement(msg) }, 100, Components.interfaces.nsITimer.TYPE_ONE_SHOT);
    }
  }
}

function clickElement(msg) {
  var element = getKnownElement([msg.json.element]);
  if (!element) {
    return;
  }
  element.click();
  sendOk();
}

