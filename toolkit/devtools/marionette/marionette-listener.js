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
var winUtil = content.QueryInterface(Components.interfaces.nsIInterfaceRequestor).getInterface(Components.interfaces.nsIDOMWindowUtils);
var listenerId = null; //unique ID of this listener
var activeFrame = null;
var win = content;

function registerSelf() {
  var register = sendSyncMessage("Marionette:register", {value: winUtil.outerWindowID, href: content.location.href});
  
  if (register[0]) {
    listenerId = register[0];
    startListeners();
  }
}

function startListeners() {
  addMessageListener("Marionette:newSession" + listenerId, newSession);
  addMessageListener("Marionette:executeScript" + listenerId, executeScript);
  addMessageListener("Marionette:setScriptTimeout" + listenerId, setScriptTimeout);
  addMessageListener("Marionette:executeAsyncScript" + listenerId, executeAsyncScript);
  addMessageListener("Marionette:executeJSScript" + listenerId, executeJSScript);
  addMessageListener("Marionette:setSearchTimeout" + listenerId, setSearchTimeout);
  addMessageListener("Marionette:goUrl" + listenerId, goUrl);
  addMessageListener("Marionette:getUrl" + listenerId, getUrl);
  addMessageListener("Marionette:goBack" + listenerId, goBack);
  addMessageListener("Marionette:goForward" + listenerId, goForward);
  addMessageListener("Marionette:refresh" + listenerId, refresh);
  addMessageListener("Marionette:findElement" + listenerId, findElement);
  addMessageListener("Marionette:clickElement" + listenerId, clickElement);
  addMessageListener("Marionette:switchToFrame" + listenerId, switchToFrame);
  addMessageListener("Marionette:deleteSession" + listenerId, deleteSession);
  addMessageListener("Marionette:sleepSession" + listenerId, sleepSession);
}
 
function newSession(msg) {
  isB2G = msg.json.B2G;
  resetValues();
  sendResponse({value: listenerId});
}

function sleepSession(msg) {
  deleteSession();
  addMessageListener("Marionette:restart", restart);
}

function restart() {
  removeMessageListener("Marionette:restart", restart);
  registerSelf();
}

function deleteSession(msg) {
  removeMessageListener("Marionette:newSession" + listenerId, newSession);
  removeMessageListener("Marionette:executeScript" + listenerId, executeScript);
  removeMessageListener("Marionette:setScriptTimeout" + listenerId, setScriptTimeout);
  removeMessageListener("Marionette:executeAsyncScript" + listenerId, executeAsyncScript);
  removeMessageListener("Marionette:executeJSScript" + listenerId, executeJSScript);
  removeMessageListener("Marionette:setSearchTimeout" + listenerId, setSearchTimeout);
  removeMessageListener("Marionette:goUrl" + listenerId, goUrl);
  removeMessageListener("Marionette:getUrl" + listenerId, getUrl);
  removeMessageListener("Marionette:goBack" + listenerId, goBack);
  removeMessageListener("Marionette:goForward" + listenerId, goForward);
  removeMessageListener("Marionette:refresh" + listenerId, refresh);
  removeMessageListener("Marionette:findElement" + listenerId, findElement);
  removeMessageListener("Marionette:clickElement" + listenerId, clickElement);
  removeMessageListener("Marionette:switchToFrame" + listenerId, switchToFrame);
  removeMessageListener("Marionette:deleteSession" + listenerId, deleteSession);
  removeMessageListener("Marionette:sleepSession" + listenerId, sleepSession);
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
      if (element == win.document) {
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

/* Convert values to primitives that can be transported over the Marionette
 * JSON protocol.
 */
function wrapValue(val) {
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
          result.push(wrapValue(val[i]));
        }
      }
      else if (val == null) {
        result = null;
      }
      // nodeType 1 == 'element'
      else if (val.nodeType == 1) {
        for(var i in seenItems) {
          if (seenItems[i] == val) {
            result = {'ELEMENT': i};
          }
        }
        result = {'ELEMENT': addToKnownElements(val)};
      }
      else {
        result = {};
        for (var prop in val) {
          result[prop] = wrapValue(val[prop]);
        }
      }
      break;
  }
  return result;
}

/* convert any ELEMENT references in 'args' to the actual elements */
function convertWrappedArguments(args) {
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
          converted.push(convertWrappedArguments(args[i]));
        }
      }
      else if (typeof(args['ELEMENT'] === 'string') &&
               args.hasOwnProperty('ELEMENT')) {
        converted = getKnownElement(args['ELEMENT']);
        if (converted == null)
          throw "Unknown element: " + args['ELEMENT'];
      }
      else {
        converted = {};
        for (var prop in args) {
          converted[prop] = convertWrappedArguments(args[prop]);
        }
      }
      break;
  }
  return converted;
}

/*
 * Execute* helpers
 */

/* Apply any namedArgs to the Marionette object */
function applyNamedArgs(args) {
  Marionette.namedArgs = {};
  args.forEach(function(arg) {
    if (typeof(arg['__marionetteArgs']) === 'object') {
      for (var prop in arg['__marionetteArgs']) {
        Marionette.namedArgs[prop] = arg['__marionetteArgs'][prop];
      }
    }
  });
}

/* send error when we detect an unload event during async scripts */
function errUnload() {
  sendError("unload was called", 17, null);
}

/* upon completion or error from the async script, send response to marionette-responder */
function asyncResponse() {
  win.removeEventListener("unload", errUnload, false);
  win.document.removeEventListener("marionette-async-response", asyncResponse, false);

  /* clear all timeouts potentially generated by the script*/
  var maxTimeoutId = win.document.getUserData('__marionetteTimeoutId');
  for(var i=0; i<=maxTimeoutId; i++) {
    win.clearTimeout(i);
  }

  var res = win.document.getUserData('__marionetteRes');
  if (res.status == 0){
    sendResponse({value: wrapValue(res.value), status: res.status});
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
  var args = msg.json.args;
  try {
    args = convertWrappedArguments(args);
  }
  catch(e) {
    return;
  }

  Marionette.is_async = false;
  Marionette.win = win;
  Marionette.context = "content";
  applyNamedArgs(args);

  var sandbox = new Cu.Sandbox(win);
  sandbox.window = win;
  sandbox.document = sandbox.window.document;
  sandbox.navigator = sandbox.window.navigator;
  sandbox.__marionetteParams = args;
  sandbox.__proto__ = sandbox.window;
  sandbox.Marionette = Marionette;
  try {
    if (directInject) {
      var res = Cu.evalInSandbox(script, sandbox, "1.8");
      if (res == undefined || res.passed == undefined) {
        sendError("Marionette.finish() not called", 17, null);
      }
      else {
        sendResponse({value: wrapValue(res)});
      }
    }
    else {
      var scriptSrc = "var __marionetteFunc = function(){" + script +
                    "};  __marionetteFunc.apply(null, __marionetteParams);";
      var res = Cu.evalInSandbox(scriptSrc, sandbox, "1.8");
      sendResponse({value: wrapValue(res)});
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
  win.addEventListener("unload", errUnload, false);
  var script = msg.json.value;
  var scriptSrc;
  var args = msg.json.args ? msg.json.args : [];
  try {
    args = convertWrappedArguments(args);
  }
  catch(e) {
    return;
  }

  // Error code 28 is scriptTimeout, but spec says execute_async should return 21 (Timeout),
  // see http://code.google.com/p/selenium/wiki/JsonWireProtocol#/session/:sessionId/execute_async.
  // However Selenium code returns 28, see
  // http://code.google.com/p/selenium/source/browse/trunk/javascript/firefox-driver/js/evaluate.js.
  // We'll stay compatible with the Selenium code.
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
  win.document.addEventListener("marionette-async-response", asyncResponse, false);

  Marionette.is_async = true;
  Marionette.win = win;
  Marionette.context = "content";
  applyNamedArgs(args);

  var sandbox = new Cu.Sandbox(win);
  sandbox.window = win;
  sandbox.document = sandbox.window.document;
  sandbox.timeoutId = null;
  sandbox.navigator = sandbox.window.navigator;
  sandbox.__marionetteParams = args;
  sandbox.document.setUserData("__marionetteRes", {}, null);
  sandbox.__proto__ = sandbox.window;
  sandbox.Marionette = Marionette;
  sandbox.is = Marionette.is;
  sandbox.isnot = Marionette.isnot;
  sandbox.ok = Marionette.ok;
  sandbox.finish = Marionette.finish;
  try {
   Cu.evalInSandbox(scriptSrc, sandbox, "1.8");
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

function goUrl(msg) {
  if (activeFrame != null) {
    win.document.location = msg.json.value;
    //TODO: replace this with event firing when Bug 720714 is resolved
    var checkTimer = Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer);
    var checkLoad = function () { 
                      if (win.document.readyState == "complete") { 
                        sendOk();
                      } 
                      else { 
                        checkTimer.initWithCallback(checkLoad, 100, Components.interfaces.nsITimer.TYPE_ONE_SHOT);
                      }
                    };
    checkLoad();
  }
  else {
    sendAsyncMessage("Marionette:goUrl", {value: msg.json.value});
  }
}

function getUrl(msg) {
  sendResponse({value: win.location.href});
}

function goBack(msg) {
  win.history.back();
  sendOk();
}

function goForward(msg) {
  win.history.forward();
  sendOk();
}

function refresh(msg) {
  win.location.reload(true);
  var listen = function() { removeEventListener("DOMContentLoaded", arguments.callee, false); sendOk() } ;
  addEventListener("DOMContentLoaded", listen, false);
}

//Todo: extend to support findChildElement
function findElement(msg) {
  var startTime = msg.json.time ? msg.json.time : new Date().getTime();
  var rootNode = win.document;
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

function switchToFrame(msg) {
  var foundFrame = null;
  if ((msg.json.value == null) && (msg.json.element == null)) {
    win = content;
    activeFrame = null;
    content.focus();
    sendOk();
    return;
  }
  if (msg.json.element != undefined) {
    if (this.seenItems[msg.json.element] != undefined) {
      var wantedFrame = seenItems[msg.json.element]; //HTMLIFrameElement
      var numFrames = win.frames.length;
      for (var i = 0; i < numFrames; i++) {
        if (win.frames[i].frameElement == wantedFrame) {
          win = win.frames[i]; 
          activeFrame = i;
          win.focus();
          sendOk();
          return;
        }
      }
    }
  }
  switch(typeof(msg.json.value)) {
    case "string" :
      var foundById = null;
      var numFrames = win.frames.length;
      for (var i = 0; i < numFrames; i++) {
        //give precedence to name
        var frame = win.frames[i];
        var frameElement = frame.frameElement;
        if (frameElement.name == msg.json.value) {
          foundFrame = i;
          break;
        } else if ((foundById == null) && (frameElement.id == msg.json.value)) {
          foundById = i;
        }
      }
      if ((foundFrame == null) && (foundById != null)) {
        foundFrame = foundById;
      }
      break;
    case "number":
      if (win.frames[msg.json.value] != undefined) {
        foundFrame = msg.json.value;
      }
      break;
  }
  //TODO: implement index
  if (foundFrame != null) {
    var frameWindow = win.frames[foundFrame];
    activeFrame = foundFrame;
    win = frameWindow;
    win.focus();
    sendOk();
  } else {
    sendError("Unable to locate frame: " + msg.json.value, 8, null);
  }
}

registerSelf();
