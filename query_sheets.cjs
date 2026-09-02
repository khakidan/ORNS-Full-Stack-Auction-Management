const http = require('http');

console.log("Fetching config to get spreadsheet ID...");
http.get('http://127.0.0.1:3000/api/config', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log("Config Data:", data);
  });
});
