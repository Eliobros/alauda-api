const spdl = require('spdl-core');

async function test() {
    const data = await spdl('https://open.spotify.com/track/3n3Ppam7vgaVa1iaRUc9Lp');
    console.log(data);
}
test();
