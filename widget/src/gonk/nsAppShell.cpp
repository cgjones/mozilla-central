/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 4 -*- */
/* vim: set ts=4 sw=4 sts=4 tw=80 et: */
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
 * The Original Code is Gonk.
 *
 * The Initial Developer of the Original Code is
 * the Mozilla Foundation.
 * Portions created by the Initial Developer are Copyright (C) 2011
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Michael Wu <mwu@mozilla.com>
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

#define _GNU_SOURCE

#include <dirent.h>
#include <fcntl.h>
#include <linux/input.h>
#include <signal.h>
#include <sys/epoll.h>
#include <sys/ioctl.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <unistd.h>

#include "nsAppShell.h"
#include "nsGkAtoms.h"
#include "nsGUIEvent.h"
#include "nsWindow.h"
#include "nsIObserverService.h"
#include "mozilla/Services.h"

#include "android/log.h"

#ifndef ABS_MT_TOUCH_MAJOR
// Taken from include/linux/input.h
// XXX update the bionic input.h so we don't have to do this!
#define ABS_MT_TOUCH_MAJOR      0x30    /* Major axis of touching ellipse */
#define ABS_MT_TOUCH_MINOR      0x31    /* Minor axis (omit if circular) */
#define ABS_MT_WIDTH_MAJOR      0x32    /* Major axis of approaching ellipse */
#define ABS_MT_WIDTH_MINOR      0x33    /* Minor axis (omit if circular) */
#define ABS_MT_ORIENTATION      0x34    /* Ellipse orientation */
#define ABS_MT_POSITION_X       0x35    /* Center X ellipse position */
#define ABS_MT_POSITION_Y       0x36    /* Center Y ellipse position */
#define ABS_MT_TOOL_TYPE        0x37    /* Type of touching device */
#define ABS_MT_BLOB_ID          0x38    /* Group a set of packets as a blob */
#define ABS_MT_TRACKING_ID      0x39    /* Unique ID of initiated contact */
#define ABS_MT_PRESSURE         0x3a    /* Pressure on contact area */
#define SYN_MT_REPORT           2
#endif

#define LOG(args...)  __android_log_print(ANDROID_LOG_INFO, "Gonk" , ## args)

using namespace mozilla;

bool gDrawRequest = false;
static nsAppShell *gAppShell = NULL;
static int epollfd = 0;
static int signalfds[2] = {0};

class fdHandler;
typedef void(*fdHandlerCallback)(int, fdHandler *);

class fdHandler {
public:
    fdHandler() : mtState(MT_START), mtDown(false) { }

    int fd;
    fdHandlerCallback func;
    enum mtStates {
        MT_START,
        MT_COLLECT,
        MT_IGNORE
    } mtState;
    int mtX, mtY;
    int mtMajor;
    bool mtDown;

    void run()
    {
        func(fd, this);
    }
};

static nsTArray<fdHandler> gHandlers;

namespace mozilla {

bool ProcessNextEvent()
{
    return gAppShell->ProcessNextNativeEvent(true);
}

void NotifyEvent()
{
    gAppShell->NotifyNativeEvent();
}

}

// XXX we wouldn't have to do this if we had epoll_pwait
static void
wakeupSigHandler(int signal)
{
    write(signalfds[1], "w", 1);
}

static void
pipeHandler(int fd, fdHandler *data)
{
    ssize_t len;
    do {
        char tmp[32];
        len = read(fd, tmp, sizeof(tmp));
    } while (len > 0);
}

static
PRUint64 timevalToMS(const struct timeval &time)
{
    return time.tv_sec * 1000 + time.tv_usec / 1000;
}

static void
sendMouseEvent(PRUint32 msg, struct timeval *time, int x, int y)
{
    nsMouseEvent event(true, msg, NULL,
                       nsMouseEvent::eReal, nsMouseEvent::eNormal);

    event.refPoint.x = x;
    event.refPoint.y = y;
    event.time = timevalToMS(*time);
    event.isShift = false;
    event.isControl = false;
    event.isMeta = false;
    event.isAlt = false;
    event.button = nsMouseEvent::eLeftButton;
    if (msg != NS_MOUSE_MOVE)
        event.clickCount = 1;

    nsWindow::DispatchInputEvent(event);
    //LOG("Dispatched type %d at %dx%d", msg, x, y);
}

static void
multitouchHandler(int fd, fdHandler *data)
{
    input_event events[16];
    int event_count = read(fd, events, sizeof(events));
    if (event_count < 0) {
        LOG("Error reading in multitouchHandler");
        return;
    }

    event_count /= sizeof(struct input_event);

    for (int i = 0; i < event_count; i++) {
        input_event *event = &events[i];

        if (event->type == EV_ABS) {
            if (data->mtState == fdHandler::MT_IGNORE)
                continue;
            if (data->mtState == fdHandler::MT_START)
                data->mtState = fdHandler::MT_COLLECT;

            switch (event->code) {
            case ABS_MT_TOUCH_MAJOR:
                data->mtMajor = event->value;
                break;
            case ABS_MT_TOUCH_MINOR:
            case ABS_MT_WIDTH_MAJOR:
            case ABS_MT_WIDTH_MINOR:
            case ABS_MT_ORIENTATION:
            case ABS_MT_TOOL_TYPE:
            case ABS_MT_BLOB_ID:
            case ABS_MT_TRACKING_ID:
            case ABS_MT_PRESSURE:
                break;
            case ABS_MT_POSITION_X:
                data->mtX = event->value;
                break;
            case ABS_MT_POSITION_Y:
                data->mtY = event->value;
                break;
            default:
                LOG("Got unknown event type 0x%04x with code 0x%04x and value %d",
                    event->type, event->code, event->value);
            }
        } else if (event->type == EV_SYN) {
            switch (event->code) {
            case SYN_MT_REPORT:
                if (data->mtState == fdHandler::MT_COLLECT)
                    data->mtState = fdHandler::MT_IGNORE;
                break;
            case SYN_REPORT:
                if ((!data->mtMajor || data->mtState == fdHandler::MT_START)) {
                    sendMouseEvent(NS_MOUSE_BUTTON_UP, &event->time,
                                   data->mtX, data->mtY);
                    data->mtDown = false;
                    //LOG("Up mouse event");
                } else if (!data->mtDown) {
                    sendMouseEvent(NS_MOUSE_BUTTON_DOWN, &event->time,
                                   data->mtX, data->mtY);
                    data->mtDown = true;
                    //LOG("Down mouse event");
                } else {
                    sendMouseEvent(NS_MOUSE_MOVE, &event->time,
                                   data->mtX, data->mtY);
                    data->mtDown = true;
                }
                data->mtState = fdHandler::MT_START;
                break;
            default:
                LOG("Got unknown event type 0x%04x with code 0x%04x and value %d",
                    event->type, event->code, event->value);
            }
        } else
            LOG("Got unknown event type 0x%04x with code 0x%04x and value %d",
                event->type, event->code, event->value);
    }
}

static void
sendKeyEventWithMsg(PRUint32 keyCode, PRUint32 msg, const struct timeval &time)
{
    nsKeyEvent event(true, msg, NULL);
    event.time = timevalToMS(time);
    nsWindow::DispatchInputEvent(event);
}

static void
sendKeyEvent(PRUint32 keyCode, bool keyDown, const struct timeval &time)
{
    sendKeyEventWithMsg(keyCode, keyDown ? NS_KEY_DOWN : NS_KEY_UP, time);
    sendKeyEventWithMsg(keyCode, NS_KEY_PRESS, time);
    /*if (keyDown) {
        // Send a key press event right after the key down event.
        sendKeyEventWithMsg(keyCode, NS_KEY_PRESS, time);
    }*/
}

static void
sendSpecialKeyEvent(nsIAtom *command, const struct timeval &time)
{
    nsCommandEvent event(true, nsGkAtoms::onAppCommand, command, NULL);
    event.time = timevalToMS(time);
    nsWindow::DispatchInputEvent(event);
}

static void
keyHandler(int fd, fdHandler *data)
{
    // The Linux kernel's input documentation (Documentation/input/input.txt)
    // says that we'll always read a multiple of sizeof(input_event) bytes here.
    input_event events[16];
    ssize_t bytesRead = read(fd, events, sizeof(events));
    if (bytesRead < 0) {
        LOG("Error reading in keyHandler");
        return;
    }
    MOZ_ASSERT(bytesRead % sizeof(input_event) == 0);

    for (unsigned int i = 0; i < bytesRead / sizeof(struct input_event); i++) {
        const input_event &e = events[i];

        if (e.type == EV_SYN) {
            // Ignore this event; it just signifies that a key was pressed.
            continue;
        }

        if (e.type != EV_KEY) {
            LOG("Got unknown key event type. type 0x%04x code 0x%04x value %d",
                e.type, e.code, e.value);
            continue;
        }

        if (e.value != 0 && e.value != 1) {
            LOG("Got unknown key event value. type 0x%04x code 0x%04x value %d",
                e.type, e.code, e.value);
            continue;
        }

        bool pressed = e.value == 1;
        const char* upOrDown = pressed ? "pressed" : "released";
        switch (e.code) {
        case KEY_BACK:
            LOG("Back key %s", upOrDown);
            if (!pressed)
                sendSpecialKeyEvent(nsGkAtoms::Clear, e.time);
            break;
        case KEY_MENU:
            LOG("Menu key %s", upOrDown);
            if (!pressed)
                sendSpecialKeyEvent(nsGkAtoms::Menu, e.time);
            break;
        case KEY_SEARCH:
            LOG("Search key %s", upOrDown);
            if (pressed)
                sendSpecialKeyEvent(nsGkAtoms::Search, e.time);
            break;
        case KEY_HOME:
            LOG("Home key %s", upOrDown);
            sendKeyEvent(NS_VK_HOME, pressed, e.time);
            if (pressed) {
                nsCOMPtr<nsIObserverService> obsServ =
                    mozilla::services::GetObserverService();
                obsServ->NotifyObservers(NULL, "home-button-pressed", NULL);
            }
            break;
        case KEY_POWER:
            LOG("Power key %s", upOrDown);
            sendKeyEvent(NS_VK_SLEEP, pressed, e.time);
            break;
        case KEY_VOLUMEUP:
            LOG("Volume up key %s", upOrDown);
            if (pressed)
                sendSpecialKeyEvent(nsGkAtoms::VolumeUp, e.time);
            break;
        case KEY_VOLUMEDOWN:
            LOG("Volume down key %s", upOrDown);
            if (pressed)
                sendSpecialKeyEvent(nsGkAtoms::VolumeDown, e.time);
            break;
        default:
            LOG("Got unknown key event code. type 0x%04x code 0x%04x value %d",
                e.type, e.code, e.value);
        }
    }
}

nsAppShell::nsAppShell()
    : mNativeCallbackRequest(false)
{
    gAppShell = this;
}

nsAppShell::~nsAppShell()
{
    gAppShell = NULL;
}

nsresult
nsAppShell::Init()
{
    epoll_event event = {
        EPOLLIN,
        { 0 }
    };

    nsresult rv = nsBaseAppShell::Init();
    NS_ENSURE_SUCCESS(rv, rv);

    epollfd = epoll_create(16);
    NS_ENSURE_TRUE(epollfd >= 0, NS_ERROR_UNEXPECTED);

    int ret = pipe2(signalfds, O_NONBLOCK);
    NS_ENSURE_FALSE(ret, NS_ERROR_UNEXPECTED);

    fdHandler *handler = gHandlers.AppendElement();
    handler->fd = signalfds[0];
    handler->func = pipeHandler;
    event.data.u32 = gHandlers.Length() - 1;
    ret = epoll_ctl(epollfd, EPOLL_CTL_ADD, signalfds[0], &event);
    NS_ENSURE_FALSE(ret, NS_ERROR_UNEXPECTED);

    DIR *dir = opendir("/dev/input");
    NS_ENSURE_TRUE(dir, NS_ERROR_UNEXPECTED);

    chdir("/dev/input");

#define BITSET(bit, flags) (flags[bit >> 3] & (1 << (bit & 0x7)))

    struct dirent *entry;
    while ((entry = readdir(dir))) {
        char entryName[64];
        int fd = open(entry->d_name, O_RDONLY);
        if (ioctl(fd, EVIOCGNAME(sizeof(entryName)), entryName) >= 0)
            LOG("Found device %s - %s", entry->d_name, entryName);
        else
            continue;

        fdHandlerCallback handlerFunc = NULL;

        char flags[(NS_MAX(ABS_MAX, KEY_MAX) + 1) / 8];
        if (ioctl(fd, EVIOCGBIT(EV_ABS, sizeof(flags)), flags) >= 0 &&
            BITSET(ABS_MT_POSITION_X, flags)) {

            LOG("Found absolute input device");
            handlerFunc = multitouchHandler;
        }
        else if (ioctl(fd, EVIOCGBIT(EV_KEY, sizeof(flags)), flags) >= 0) {
            LOG("Found key input device");
            handlerFunc = keyHandler;
        }

        // Register the handler, if we have one.
        if (!handlerFunc)
            continue;

        handler = gHandlers.AppendElement();
        handler->fd = fd;
        handler->func = handlerFunc;
        event.data.u32 = gHandlers.Length() - 1;
        if (epoll_ctl(epollfd, EPOLL_CTL_ADD, fd, &event))
            LOG("Failed to add fd to epoll fd");
    }

    struct sigaction sig = {
        { wakeupSigHandler },
        0,
        0,
        NULL
    };
    ret = sigaction(SIGUSR2, &sig, NULL);
    NS_ENSURE_FALSE(ret, NS_ERROR_UNEXPECTED);

    return rv;
}

void
nsAppShell::ScheduleNativeEventCallback()
{
    mNativeCallbackRequest = true;
    NotifyEvent();
}

bool
nsAppShell::ProcessNextNativeEvent(bool mayWait)
{
    epoll_event events[16] = {{ 0 }};

    int event_count;
    if ((event_count = epoll_wait(epollfd, events, 16,  mayWait ? -1 : 0)) <= 0)
        return true;

    for (int i = 0; i < event_count; i++)
        gHandlers[events[i].data.u32].run();

    if (mNativeCallbackRequest) {
        mNativeCallbackRequest = false;
        NativeEventCallback();
    }

    if (gDrawRequest) {
        gDrawRequest = false;
        nsWindow::DoDraw();
    }

    return true;
}

void
nsAppShell::NotifyNativeEvent()
{
    kill(getpid(), SIGUSR2);
}

