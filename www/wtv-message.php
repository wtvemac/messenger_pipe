<?php
/*

What:
	WebTV Client Message Broker (server-side)
By:
	{dFb}eMac
Date:
	July 9th 2023

About: 
	This is a really basic messaging framework so two WebTV clients can talk to each other. This
	allows the ability to create multiplayer games, private IM clients, remote control tools and the like.
	Messages are sent through a simple central PHP script that receives messages, keeps state and stores 
	messages to be consumed on the peer box.

	This script was essentially farted out in a day. Adjust your expextations. All code is unlicensed.
	Use this code however you want! https://choosealicense.com/licenses/unlicense/
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

// The folder where you put all our junk. Session list, session messages etc...
$session_folder = "./wtv-message-sessions";

// The session timeout since a last message ($loose_heartbeat = true) or last heartbeat ($loose_heartbeat = false)
$session_timeout_secs = 60 * 2; # 2 mins

// The session age since a last message or last heartbeat before we don't consider this session a valid peer.
$session_peer_age_secs = 20; # 20 secs

// Allows us to ditch a heartbeat signal and rely on message polling to know when a box is still alive.
$loose_heartbeat = true;

// The name of the form. Not really useful generally but may be useful in the code on the client.
$form_name = "messengerForm";

/// ----------------------------------------------------------------------------------- ///
/// ----------------------------------------------------------------------------------- ///
/// ----------------------------------------------------------------------------------- ///
/// ----------------------------------------------------------------------------------- ///
/// ----------------------------------------------------------------------------------- ///
/// ----------------------------------------------------------------------------------- ///

session_start();

$in_message = (isset($_REQUEST["message"]) && !empty($_REQUEST["message"])) ? $_REQUEST["message"] : "";
$logout = (isset($_REQUEST["logout"])) ? true : false;
$wipe = (isset($_REQUEST["wipe"])) ? true : false;

$session_id = uniqid("wtv-", true);

if(isset($_REQUEST["sessionId"]) && !empty($_REQUEST["sessionId"]))
{
	$session_id = $_REQUEST["sessionId"];
}
else
{
	if(!isset($_SESSION["session_id"]))
	{
		$_SESSION["session_id"] = $session_id;
	}

	$session_id = $_SESSION["session_id"];
}

$update_session = false;
$output_peers = false;
$current_session_index = -1;
$sessions = array();

if($session_id)
{
	if(!is_dir($session_folder))
	{
		mkdir($session_folder, 0777, true);
	}

	$sessions_file_name = $session_folder . "/sessions.json";
	$messages_file_name = $session_folder . "/" . $session_id . ".json";

	// Can be bad (wiping without authentication) but this is a silly thing and we don't care right?
	if($wipe)
	{
		
		if ($hDIR = opendir($session_folder))
		{
			while (($file = readdir($hDIR)) !== false)
			{
				if(preg_match("/\.json$/i", $file))
				{
					unlink($session_folder . "/" . $file);
				}
			}
			closedir($hDIR);
		}

		file_put_contents($sessions_file_name, json_encode(array()));

		print "wiped";
		exit;
	}

	$_sessions = json_decode(file_get_contents($sessions_file_name), true);
	$sessions = array();

	for($i = 0; $i < count($_sessions); $i++)
	{
		if((time() - $_sessions[$i]["last_update_time"]) < $session_timeout_secs)
		{
			if($session_id == $_sessions[$i]["id"])
			{
				if($logout)
				{
					$update_session = true;
					continue;
				}
				else
				{
					$current_session_index = count($sessions);
				}
			}

			$sessions[] = $_sessions[$i];
		}
		elseif($_sessions[$i]["id"] && is_numeric($_sessions[$i]["id"]))
		{
			unlink($session_folder . "/" . $_sessions[$i]["id"] . ".json");
		}
	}

	if($logout)
	{
		unlink($messages_file_name);
	}
	elseif($current_session_index == -1)
	{
		$current_session = array(
			"id" => $session_id,
			"name" => "",
			"start_time" => time(),
			"last_update_time" => time(),
			"companion" => ""
		);

		$sessions[] = $current_session;
		$current_session_index = count($sessions) - 1;
		$update_session = true;
	}

	if($in_message)
	{
		$new_messages = array();
		$previous_messages = array();
		$wipe_old = false;

		foreach (explode('&', $in_message) as $_message)
		{
			$_message_namevalue = explode("=", $_message);

			if($_message_namevalue)
			{
				$name = urldecode($_message_namevalue[0]);
				$value = urldecode($_message_namevalue[1]);

				if($name == "getPeers")
				{
					$output_peers = true;
				}
				elseif($name == "setCompanion")
				{
					$name = $session_id;
					for($i = 0; $i < count($sessions); $i++)
					{
						// Can be bad (setting companion without cross-checking) but this is a silly thing and we don't care right?
						if($sessions[$i]["id"] == $value)
						{
							$sessions[$i]["companion"] = $session_id;
							$name = $sessions[$i]["name"];
							break;
						}
					}

					$sessions[$current_session_index]["companion"] = $value;
					$new_messages[] = array("setCompanion" => urlencode($name) . "=" . urlencode($value));
					$update_session = true;
				}
				elseif($name == "okGame")
				{
					$new_messages[] = array("okGame" => urlencode($sessions[$current_session_index]["name"]) . "=" . urlencode($sessions[$current_session_index]["id"]));
				}
				elseif($name == "restartGame")
				{
					$new_messages[] = array("restartGame" => urlencode($sessions[$current_session_index]["name"]) . "=" . urlencode($sessions[$current_session_index]["id"]));
					$wipe_old = true;
				}
				elseif($name == "setName")
				{
					$sessions[$current_session_index]["name"] = $value;
					$update_session = true;
					$new_messages[] = array("setName" => $value);
				}
				elseif($name == "heartBeat")
				{
					$update_session = true;
				}
				else
				{
					$new_messages[] = array($name => $value);
				}
			}
		}

		if(file_exists($messages_file_name) && !$wipe_old)
		{
			$previous_messages = json_decode(file_get_contents($messages_file_name), true);
		}

		if(!empty($new_messages))
		{
			$messages = array_merge($previous_messages, $new_messages);

			file_put_contents($messages_file_name, json_encode($messages));
		}
	}

	if($update_session || $loose_heartbeat)
	{
		if($current_session_index >= 0)
		{
			$sessions[$current_session_index]["last_update_time"] = time();
		}

		file_put_contents($sessions_file_name, json_encode($sessions));
	}
}

$out_message = "";
if($current_session_index >= 0 && isset($sessions[$current_session_index]) && !empty($sessions[$current_session_index]))
{
	$current_session = $sessions[$current_session_index];

	if($output_peers)
	{
		foreach ($sessions as $session)
		{
			if((time() - $session["last_update_time"]) < $session_peer_age_secs)
			{
				if($session["companion"] == $session_id)
				{
					$out_message = urlencode($session["name"]) . "=" . urlencode($session["id"]) . "&";
					break;
				}
				elseif(!empty($session["name"]) && empty($session["companion"]) && $session["id"] != $session_id)
				{
					$out_message .= urlencode($session["name"]) . "=" . urlencode($session["id"]) . "&";
				}
			}
		}
	}
	elseif(isset($current_session["companion"]) && !empty($current_session["companion"]))
	{
		$companion_messages_file_name = $session_folder . "/" . $current_session["companion"] . ".json";

		$companion_messages = json_decode(file_get_contents($companion_messages_file_name), true);

		foreach ($companion_messages as $companion_message)
		{
			$out_message .= urlencode(array_keys($companion_message)[0]) . "=" . urlencode(array_values($companion_message)[0]) . "&";
		}

		file_put_contents($companion_messages_file_name, json_encode(array()));
	}
}

?><script language="JavaScript">parent.doRequestFinal("<?php print $out_message; ?>", "<?php print $session_id; ?>");</script>