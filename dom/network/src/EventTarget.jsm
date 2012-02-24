/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

const EXPORTED_SYMBOLS = ["EventTarget", "defineEventListenerSlot"];

/**
 * Define an event listener slot on an object, e.g.
 *
 *   obj.onerror = function () {...}
 *
 * will register the function as an event handler for the "error" event
 * if the "error" slot was defined on 'obj' or its prototype.
 */
function defineEventListenerSlot(object, event_type) {
  let property_name = "on" + event_type;
  let hidden_name = "_on" + event_type;
  object.__defineGetter__(property_name, function getter() {
    return this[hidden_name];
  });
  object.__defineSetter__(property_name, function setter(handler) {
    let old_handler = this[hidden_name];
    if (old_handler) {
      this.removeEventListener(event_type, old_handler);
    }
    this.addEventListener(event_type, handler);
    this[hidden_name] = handler;
  });
}

/**
 * Base object for event targets.
 */
function EventTarget() {}
EventTarget.prototype = {

  addEventListener: function addEventListener(type, handler) {
    //TODO verify that handler is an nsIDOMEventListener (or function)
    if (!this._listeners) {
      this._listeners = {};
    }
    if (!this._listeners[type]) {
      this._listeners[type] = [];
    }
    if (this._listeners[type].indexOf(handler) != -1) {
      // The handler is already registered. Ignore.
      return;
    }
    this._listeners[type].push(handler);
  },

  removeEventListener: function removeEventListener(type, handler) {
     let list, index;
     if (this._listeners &&
         (list = this._listeners[type]) &&
         (index = list.indexOf(handler) != -1)) {
       list.splice(index, 1);
       return;
     }
  },

  dispatchEvent: function dispatchEvent(event) {
    //TODO this does not deal with bubbling, defaultPrevented, canceling, etc.
    //TODO disallow redispatch of the same event if it's already being
    // dispatched (recursion).
    if (!this._listeners) {
      return;
    }
    let handlerList = this._listeners[event.type];
    if (!handlerList) {
      return;
    }
    event.target = this;

    // We need to worry about event handler mutations during the event firing.
    // The correct behaviour is to *not* call any listeners that are added
    // during the firing and to *not* call any listeners that are removed
    // during the firing. To address this, we make a copy of the listener list
    // before dispatching and then doublecheck that each handler is still
    // registered before firing it.
    let handlers = handlerList.slice();
    handlers.forEach(function (handler) {
      if (handlerList.indexOf(handler) == -1) {
        return;
      }
      switch (typeof handler) {
        case "function":
          handler(event);
          break;
        case "object":
          handler.handleEvent(event);
          break;
      }
    });
  }
};
