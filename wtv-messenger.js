/*

What:
  WebTV Client Message Broker (box-side)
By:
  {dFb}eMac
Date:
  July 9th 2023

About: 
  This is a really basic messaging framework so two WebTV clients can talk to each other. This
  allows the ability to create multiplayer games, private IM clients, remote control tools and the like.
  Messages are sent to a simple server-side PHP script that receives messages, keeps state and stores 
  messages to be consumed on the peer box.

  Calls to the server-side script are sent asynchronously so a callback is called once the message is fully
  recieved.

  This script was essentially farted out in a day. Adjust your expextations. All code is unlicensed.
  Use this code however you want! https://choosealicense.com/licenses/unlicense/

  You should be able to copy this script, configure it and use the functions below to handle messages.
  There's some shims for older boxes that don't support some array methods.
  
*/

/*
  This is free and unencumbered software released into the public domain.

  Anyone is free to copy, modify, publish, use, compile, sell, or
  distribute this software, either in source code form or as a compiled
  binary, for any purpose, commercial or non-commercial, and by any
  means.

  In jurisdictions that recognize copyright laws, the author or authors
  of this software dedicate any and all copyright interest in the
  software to the public domain. We make this dedication for the benefit
  of the public at large and to the detriment of our heirs and
  successors. We intend this dedication to be an overt act of
  relinquishment in perpetuity of all present and future rights to this
  software under copyright law.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
  EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
  MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
  IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
  OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
  ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
  OTHER DEALINGS IN THE SOFTWARE.

  For more information, please refer to <https://unlicense.org>
*/

// Shows debug alerts when there's a major problem.
var debug = (msg_debug) ? msg_debug : 0;

// Experimental but allows you to set an index to the message broker if you want to run more than one at a time.
// We use a hidden embed to send messages. This may or may not work?
var messengerIndex = (msg_index) ? msg_index : 1;

// Sets the server-side endpoint URL that we will send calls to.
var messengerActiveEndpoint = (msg_active_endpoint) ? msg_active_endpoint : "http://localhost/wtv-message.php";

// Sets the default callback when no callback is specified in each endpoint call.
var messengerDefaultCallback = (msg_default_callback) ? msg_default_callback : null;

// The wait in milliseconds (1000 milliseconds = 1 second) to check an endpoint call. This is used to see if an endpoint call has timed out.
var requestCheckIntervalMsecs = (msg_check_interval_msecs) ? msg_check_interval_msecs : 1000;

// The amount of checks before we declare a timeout and then retry. requestCheckIntervalMsecs * requestCheckTriesBeforeRetry = time to retry.
var requestCheckTriesBeforeRetry = (check_tries_before_retry) ? check_tries_before_retry : 20;

// The wait between endpoint calls. This allows time for the box to relax between requests. Don't want to bog it down y'know.
var requestSpacingMsecs = (msg_spacing_msecs) ? msg_spacing_msecs : 3000;

// Send session ID in request. Used for when you have cookie issues.
var requestNoCookies = (msg_no_cookies) ? msg_no_cookies : false;

/*

SetSessionName(name, callback, priority)
  Gives the current session a name. This can be a player name.
  If you want this to be called asap then set prioroty to true.

GetPeers(callback, priority)
  Gets a list of peers. Sends all peers in an array to callback. Peers are sent in a NAME: SESSION_ID format.
  Each session needs a name to appear in the list.
  If no callback is set then the messengerDefaultCallback is called for each peer found. NAME=NAME VALUE=SESSION_ID

SetSessionCompanion(sessionId, callback, priority)
  Sets the companion box to send messages to. You can find a list of boxes from GetPeers.
  If you want this to be called asap then set prioroty to true.


SendMessage(name, value, callback, priority)
  Sends a generic name/value message to the companion box.

Heartbeat(callback, priority)
  Sends a heartbeat signal. This allows a box's session to not timeout. This is only needed if the server-side is configured with 
    "$loose_heartbeat = false;"

Logout(callback, priority)
  Deletes a session from the server-side and detaches from the companion box.


The callback is sent in a CALLBACK(messages) where messages is a name-value array with each message.
The default callback is sent in a CALLBACK(name, value) where each element of the array is sent individuallly.

*/

/// ----------------------------------------------------------------------------------- ///
/// ----------------------------------------------------------------------------------- ///
/// ----------------------------------------------------------------------------------- ///
/// ----------------------------------------------------------------------------------- ///
/// ----------------------------------------------------------------------------------- ///
/// ----------------------------------------------------------------------------------- ///

var messageQueue = new Array();
var requestCheckIntervalObj = null;
var requestCheckIntervalEnabled = false;
var requestSpacingIntervaObj = null;
var requestSpacingIntervalEnabled = false;
var _debug = 0;
var checkIndex = 0;
var messenegrEmbedNamePrefix = "messengerForm";
var messenegrFormName = "messengerForm";
var currentCallback = null;
var requestCheckTries = 0;
var currentSessionid = "";

function silenceDbg()
{
  _debug = debug;
  debug = 0;
}

function resetDbg()
{
  debug = _debug;
}

function dbg()
{
  if(debug)
  {
    var message = "";

    // work on 1.0 viewer?
    for(var i = 0; i < arguments.length; i++)
    {
      if(message != "")
      {
        message += " ";
      }

      var _message = "";
      if(arguments[i] == null)
      {
        _message = "!NULL!";
      }
      else if(arguments[i] == undefined)
      {
        _message = "!UNDEFINED!";
      }
      else
      {
        _message = arguments[i].toString();

        if(_message == "[object Array]")
        {
          _message = "Array[0:" + arguments[i].length + "]";
        }
      }


      message += _message;
    }

    alert("WTVMsnger:\n\n" + message);
  }
}

function getMessenger(index)
{
  if(!index)
  {
    if(!messengerIndex)
    {
      index = 1;
    }
    else
    {
      index = messengerIndex;
    }
  }

  if(document[messenegrEmbedNamePrefix + index])
  {
    return document[messenegrEmbedNamePrefix + index];
  }
  else if(document.all[messenegrEmbedNamePrefix + index])
  {
    return document.all[messenegrEmbedNamePrefix + index];
  }
  else if(document.embeds[index - 1])
  {
    return document.embeds[index - 1];
  }

  dbg("Couldn't get the embed element that we use to send and recieve messages. Using Index:", index);
  shutdownPolling();

  return null;
}

function getMessengerMessages(message)
{
  var messages = new Array(0);

  var pLoc = messengerSrc.indexOf(messageResultPrefix);

  if(message)
  {
    var _messages = message.split("&");

    for(var i = 0; i < _messages.length; i++)
    {
      if(_messages[i])
      {
        var message = unescape(_messages[i]);

        var push_me = new Array(unescape(message.substring(0, message.indexOf("="))), unescape(message.substring(message.indexOf("=") + 1)));

        // For the old boxes.
        if(!messages.push)
        {
          var _messages = new Array(messages.length + 1);

          for(var i = 0; i < messages.length; i++)
          {
            messages[i] = messages[i];
          }

          _messages[i] = push_me;

          messages = _messages;
        }
        else
        {
          messages.push(push_me);
        }
      }
    }
  }

  return messages;
}

function Logout(callback, priority)
{
  SendMessage("logout", true, callback, priority);
}

function Heartbeat(callback, priority)
{
  SendMessage("heartBeat", true, callback, priority);
}

function GetPeers(callback, priority)
{
  if(callback)
  {
    SendMessage("getPeers", true, callback, priority);
  }
}

function SetSessionCompanion(sessionId, callback, priority)
{
  if(sessionId)
  {
    SendMessage("setCompanion", sessionId, callback, priority);
  }
}

function SetSessionName(name, callback, priority)
{
  if(name)
  {
    SendMessage("setName", name, callback, priority);
  }
}

function SendMessage(name, value, callback, priority)
{
  if(name)
  {
    var push_me = new Array(name, value, callback, priority);

    // For the old boxes.
    if(!messageQueue.push)
    {
      var _messageQueue = new Array(messageQueue.length + 1);

      for(var i = 0; i < messageQueue.length; i++)
      {
        _messageQueue[i] = messageQueue[i];
      }

      _messageQueue[i] = push_me;

      messageQueue = _messageQueue;
    }
    else
    {
      messageQueue.push(push_me);
    }

    if(priority)
    {
      clearSpacingInterval();

      if(!requestCheckIntervalEnabled)
      {
        doMessenger();
      }
    }
  }
}

function checkMessages(message, callback)
{
  var messages = getMessengerMessages(message);

  if(messages && messages.length > 0)
  {
    if(callback)
    {
      callback(messages);
    }
    else if(messengerDefaultCallback)
    {
      for(var i = 0; i < messages.length; i++)
      {
        messengerDefaultCallback(messages[i][0], messages[i][1]);
      }
    }
  }
}

function doRequestFinal(message, session_id)
{
  var messenger = getMessenger();

  if(messenger)
  {
    if(session_id)
    {
      currentSessionid = session_id;
    }

    checkMessages(message, currentCallback);

    currentCallback = null;

    clearRequestIntervals();
    if(isNextpriority())
    {
      doMessenger();
    }
    else
    {
      startSpacingInterval();
    }
  }
}

function doRequestCheck()
{
  if(requestCheckIntervalEnabled)
  {
    var recheck = false;
    var messenger = getMessenger();

    if(messenger)
    {
      requestCheckTries++;

      if(requestCheckTries >= requestCheckTriesBeforeRetry)
      {
        requestCheckTries = 0;
        messenger.location.reload();
      }
    }
  }
}

var cool = 0;
function doSpacingInterval()
{
  if(requestSpacingIntervalEnabled)
  {
    doMessenger();
  }
}

function doMessenger()
{
  clearRequestIntervals();
  pollMessenger();
}

function pollMessenger(index)
{
  silenceDbg();
  var messenger = getMessenger(index);
  resetDbg();

  if(messenger)
  {
    messenger.src = newEmbedURL();
    startRequestCheckInterval();
  }
  else
  {
    dbg("Messenger couldn't fine messenger embed. JavaScript error?");
    shutdownPolling();
  }
}

function isNextpriority()
{
  for(var i = 0; i < messageQueue.length; i++)
  {
    if(messageQueue[3])
    {
      return true;
    }
  }

  return false;
}

function newEmbedURL()
{
  var _messengerEndpoint = messengerActiveEndpoint;

  if(_messengerEndpoint.indexOf("?") == -1)
  {
    _messengerEndpoint += "?";
  }
  else
  {
    _messengerEndpoint += "&";
  }

  if(messageQueue.length > 0)
  {
    var takeThis = -1;
    for(var i = 0; i < messageQueue.length; i++)
    {
      if(messageQueue[i] && messageQueue[i][3])
      {
        takeThis = i;
        break;
      }
      else if(takeThis == -1 && messageQueue[i])
      {
        takeThis = i;
      }

      if(takeThis == -1)
      {
        takeThis = 0;
      }
    }

    var message = messageQueue[takeThis];
    
    // For the old boxes.
    if(!messageQueue.splice)
    {
      var count = 0;
      for(var i = 0; i < messageQueue.length; i++)
      {
        if(messageQueue[i])
        {
          count++;
        }
      }

      if(count > 0)
      {
        var _messageQueue = new Array(count - 1);

        for(var i = 0, ii = 0; i < count; i++)
        {
          if(i != takeThis)
          {
            _messageQueue[ii] = messageQueue[i];
            ii++;
          }
        }

        messageQueue = _messageQueue;
      }
      else
      {
        messageQueue = new Array(0);
      }
    }
    else
    {
      messageQueue = messageQueue.splice(takeThis, 1);
    }

    if(message)
    {
      var name = message[0].toString();
      var value = message[1].toString();

      if(name == "logout")
      {
        _messengerEndpoint += "logout=" + escape(value) + "&";
      }
      else
      {
        _messengerEndpoint += "message=" + escape(escape(name) + "=" + escape(value)) + "&";
      }

      if(message[2])
      {
        currentCallback = message[2];
      }
    }
  }

  if(requestNoCookies)
  {
    _messengerEndpoint += "sessionId=" + escape(currentSessionid) + "&";
  }

  _messengerEndpoint += (++checkIndex);

  return _messengerEndpoint;
}

function writeEmbed(index, message)
{
  if(!index)
  {
    if(!messengerIndex)
    {
      index = 1;
    }
    else
    {
      index = messengerIndex;
    }
  }

  document.write('<embed name="' + messenegrEmbedNamePrefix + index + '"></embed>');
}

function startRequestCheckInterval(hard)
{
  if(!requestCheckIntervalObj || hard)
  {
    clearRequestCheckInterval(true);
    requestCheckIntervalObj = setInterval(doRequestCheck, requestCheckIntervalMsecs);
  }
  requestCheckIntervalEnabled = true;
}

function clearRequestCheckInterval(hard)
{
  if(hard)
  {
    requestCheckTries =  0;
    if(requestCheckIntervalObj)
    {
      clearInterval(requestCheckIntervalObj);
    }
    requestCheckIntervalObj = null;
  }
  requestCheckIntervalEnabled = false;
}

function startSpacingInterval(hard)
{
  if(!requestSpacingIntervaObj || hard)
  {
    clearSpacingInterval(true);
    requestSpacingIntervaObj = setInterval(doSpacingInterval, requestSpacingMsecs);
  }
  requestSpacingIntervalEnabled = true;
}

function clearSpacingInterval(hard)
{
  if(hard)
  {
    if(requestSpacingIntervaObj)
    {
      clearInterval(requestSpacingIntervaObj);
    }
    requestSpacingIntervaObj = null;
  }
  requestSpacingIntervalEnabled = false;
}

function clearRequestIntervals(hard)
{
  clearRequestCheckInterval(hard);
  clearSpacingInterval(hard);
}

function startupMessenger()
{
  startSpacingInterval(true);
}

function shutdownMessenger()
{
  clearRequestIntervals(true)
}

function initm() // use this for onload
{
  startupMessenger();
  requestSpacingIntervalEnabled = false;
}

writeEmbed();
