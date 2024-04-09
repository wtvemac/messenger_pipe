# WebTV Client Messenger Pipe

This is a some code that allows one WebTV box to communicate with another WebTV box without reloading the page. This was created as a quick demonstration after MattMan and I had a discussion about multiplayer games on the WebTV. I probably wont be fleshing this out much since it was just a proof of concept for Matt but you're welcome to use it any way you like.

There's JavaScript that runs on the client-side and PHP that runs on the server side. Both boxes will poll the server to send and recieve messages. I provided an example tictactoe game in the `example` directory.

This is used in one of Matt's HackTV builds in his multiplayer tic-tac-toe. Both the game state and chat are communicated between boxes using this.

_more details coming soon_ 

