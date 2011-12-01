
(function touchEventHandler() {
  let debugging = false;
  function debug(str) {
    if (debugging)
      dump(str + '\n');
  };

  let contextMenuTimeout = 0;

  // This guard is used to not re-enter the events processing loop for
  // self dispatched events
  let ignoreEvents = false;

  // During a 'touchstart' and the first 'touchmove' mouse events can be
  // prevented for the current touch sequence.
  let canPreventMouseEvents = false;

  // Used to track the first mousemove and to cancel click dispatc if it's not
  // true.
  let isNewTouchAction = false;

  // If this is set to true all mouse events will be cancelled by calling
  // both evt.preventDefault() and evt.stopPropagation().
  // This will not prevent a contextmenu event to be fired.
  // This can be turned on if canPreventMouseEvents is true and the consumer
  // application call evt.preventDefault();
  let preventMouseEvents = false;

  let TouchEventHandler = {
    events: ['mousedown', 'mousemove', 'mouseup', 'click', 'unload'],
    start: function teh_start() {
      this.events.forEach((function(evt) {
        shell.home.addEventListener(evt, this, true);
      }).bind(this));
    },
    stop: function teh_stop() {
      this.events.forEach((function(evt) {
        shell.home.removeEventListener(evt, this, true);
      }).bind(this));
    },
    handleEvent: function teh_handleEvent(evt) {
      if (evt.button || ignoreEvents)
        return;

      let eventTarget = this.target;
      let type = '';
      switch (evt.type) {
        case 'mousedown':
          debug('mousedown:');

          this.target = evt.target;
          this.timestamp = evt.timeStamp;
          evt.target.setCapture(false);

          preventMouseEvents = false;
          canPreventMouseEvents = true;
          isNewTouchAction = true;

          contextMenuTimeout =
            this.sendContextMenu(evt.target, evt.pageX, evt.pageY, 2000);
          this.startX = evt.pageX;
          this.startY = evt.pageY;
          type = 'touchstart';
          break;

        case 'mousemove':
          if (!eventTarget)
            return;

          // On device a mousemove event if fired right after the mousedown
          // because of the size of the finger, so let's ignore what happens
          // below 5ms
          if (evt.timeStamp - this.timestamp < 30)
            break;

          if (isNewTouchAction) {
            canPreventMouseEvents = true;
            isNewTouchAction = false;
          }

          if (Math.abs(this.startX - evt.pageX) > 15 ||
              Math.abs(this.startY - evt.pageY) > 15)
            window.clearTimeout(contextMenuTimeout);
          type = 'touchmove';
          break;

        case 'mouseup':
          if (!eventTarget)
            return;
          debug('mouseup:');

          window.clearTimeout(contextMenuTimeout);
          eventTarget.ownerDocument.releaseCapture();
          this.target = null;
          type = 'touchend';
          break;

        case 'unload':
          if (!eventTarget)
            return;

          window.clearTimeout(contextMenuTimeout);
          eventTarget.ownerDocument.releaseCapture();
          this.target = null;
          TouchEventHandler.stop();
          return;

        case 'click':
          if (!isNewTouchAction) {
            debug('click: cancel');

            evt.preventDefault();
            evt.stopPropagation();
          } else {
            // Mouse events has been cancelled so dispatch a sequence
            // of events to where touchend has been fired
            if (preventMouseEvents) {
              let target = evt.target;
              ignoreEvents = true;
              try {
                this.fireMouseEvent('mousemove', evt);
                this.fireMouseEvent('mousedown', evt);
                this.fireMouseEvent('mouseup', evt);
              } catch (e) {
                alert(e);
              }
              evt.preventDefault();
              evt.stopPropagation();
              ignoreEvents = false;
            }

            debug('click: fire');
          }
          return;
      }

      let target = eventTarget || this.target;
      if (target && type) {
        let touchEvent = this.sendTouchEvent(evt, target, type);
        if (touchEvent.getPreventDefault() && canPreventMouseEvents)
          preventMouseEvents = true;
      }

      if (preventMouseEvents) {
        evt.preventDefault();
        evt.stopPropagation();

        if (type != 'touchmove')
          debug('cancelled (fire ' + type + ')');
      }
    },
    fireMouseEvent: function teh_fireMouseEvent(type, evt)  {
      debug(type + ': fire');

      let content = evt.target.ownerDocument.defaultView;
      var utils = content.QueryInterface(Ci.nsIInterfaceRequestor)
                         .getInterface(Ci.nsIDOMWindowUtils);
      utils.sendMouseEvent(type, evt.pageX, evt.pageY, 0, 1, 0, true);
    },
    sendContextMenu: function teh_sendContextMenu(target, x, y, delay) {
      let doc = target.ownerDocument;
      let evt = doc.createEvent('MouseEvent');
      evt.initMouseEvent('contextmenu', true, true, doc.defaultView,
                         0, x, y, x, y, false, false, false, false,
                         0, null);

      let timeout = window.setTimeout((function contextMenu() {
        debug('fire context-menu');

        target.dispatchEvent(evt);
        if (!evt.getPreventDefault())
          return;

        doc.releaseCapture();
        this.target = null;

        isNewTouchAction = false;
      }).bind(this), delay);
      return timeout;
    },
    sendTouchEvent: function teh_sendTouchEvent(evt, target, name) {
      let touchEvent = document.createEvent('touchevent');
      let point = document.createTouch(window, target, 0,
                                     evt.pageX, evt.pageY,
                                     evt.screenX, evt.screenY,
                                     evt.clientX, evt.clientY,
                                     1, 1, 0, 0);
      let touches = document.createTouchList(point);
      let targetTouches = touches;
      let changedTouches = touches;
      touchEvent.initTouchEvent(name, true, true, window, 0,
                                false, false, false, false,
                                touches, targetTouches, changedTouches);
      target.dispatchEvent(touchEvent);
      return touchEvent;
    }
  };

  window.addEventListener('ContentStart', function touchStart(evt) {
    window.removeEventListener('ContentStart', touchStart);
    TouchEventHandler.start();
  });
})();

