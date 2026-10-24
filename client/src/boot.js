// Vilken del av appen ska starta? ?replay=<id> = uppspelaren, annars själva rummet.
if (new URLSearchParams(location.search).has('replay')) import('./replay.js');
else import('./main.js');
