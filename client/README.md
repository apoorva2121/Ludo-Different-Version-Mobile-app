# Client boundary

`authoritative-client.js` is the first presentation/network boundary. It sends only authenticated commands and accepts authoritative snapshots from the server. It deliberately does not persist game state, calculate destinations, generate dice, or expose a local replacement state API.

The preserved HTML now has an online presentation bridge in `online-ui.js`. It replaces dice/piece actions with authenticated WebSocket commands, maps authoritative snapshots into the existing renderer, supports pending-die selection, and reconnects by resubscribing. The standalone REST adapter remains useful for native or non-WebSocket clients. Local/tutorial/developer modes still use the original local engine.
