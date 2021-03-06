const express = require('express');
const router = express.Router();
const got = require('got');
const { ObjectID } = require('mongodb');
require('dotenv').config();
const [serialize, addQueryParams, getFields, encrypt, decrypt] = require("../utils/string_parsing");
const crypto = require('crypto'); 

router.get('/', (req, res, next) => {
  res.render('index', { title: 'Our Playlist', content: process.env.CLIENT_ID });
});

router.get('/auth', (req, res) => {
  // redirects user to spotify login page

  const params = {
    client_id: process.env.CLIENT_ID,
    response_type: 'code',
    redirect_uri: process.env.URL_PREFIX + '/host/get_tokens',
    scope: 'user-top-read playlist-modify-public'
  }

  const authURL = addQueryParams('https://accounts.spotify.com/en/authorize', params);

  res.redirect(authURL);

});

router.get('/get_tokens', (req, res, next) => {
  // requests access tokens

  if (req.query['error']) { res.redirect('/host/access_denied'); }

  const body = {
    grant_type: 'authorization_code',
    code: req.query['code'],
    redirect_uri: process.env.URL_PREFIX + '/host/get_tokens',
    client_id: process.env.CLIENT_ID,
    client_secret: process.env.CLIENT_SECRET
  };

  (async () => {

    try {

      const response = await got('https://accounts.spotify.com/api/token', {
        method: 'POST',
        body: serialize(body),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      const responseBody = JSON.parse(response.body);

      res.cookie('accessToken', responseBody['access_token'], { httpOnly: true });
      res.cookie('refreshToken', responseBody['refresh_token'], { httpOnly: true });
      res.redirect('/host/add_host');

    } catch (e) {

      console.log(e);
      res.render('index', { title: 'Our Playlist', content: "Error. Please tell Bruce about this." });

    }

  })();

});

router.get('/access_denied', (req, res) => {
  // Page for when user denies access to the app

  res.render('index', {title: 'Our Playlist'});
});

router.get('/add_host', (req, res) => {
  // Creates the group playlist

  const content = req.cookies;
  res.clearCookie('accessToken', { httpOnly: true });
  res.clearCookie('refreshToken', { httpOnly: true });

  const oID = new ObjectID();
  const ID = oID.toHexString();

  const topTrackQuery = {
      time_range: 'long_term', // TODO: add long, medium, and short term
      limit: 50,
  };

  (async (collection) => {

    try {

      const hostInfo = await (async () => { 
        
        try {

          // Get user info
          const userInfo = await got('https://api.spotify.com/v1/me', {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Authorization': 'Bearer ' + content['accessToken']
            }
          });

          const topTracks = await got(addQueryParams("https://api.spotify.com/v1/me/top/tracks", topTrackQuery), {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Authorization': 'Bearer ' + content['accessToken']
            }
          });

          const topTrackItems = JSON.parse(topTracks.body)['items'];
          const userInfoObj = JSON.parse(userInfo.body);
          const userID = userInfoObj['id'];

          // Create Playlist
          const createPlaylistBody = {
            name: "Group Playlist"
          };

          const createPlaylist = await got(`https://api.spotify.com/v1/users/${userID}/playlists`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + content['accessToken']
            },
            body: JSON.stringify(createPlaylistBody)
          });

          const createPlaylistObj = JSON.parse(createPlaylist.body);

          // Add songs to playlist
          const addSongsBody = {
            uris: topTrackItems.map(x => x['uri']).slice(0, 50), // TODO: make playlist size flexible
          };

          await got(`https://api.spotify.com/v1/playlists/${createPlaylistObj['id']}/tracks`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + content['accessToken']
            },
            body: JSON.stringify(addSongsBody)
          });

          // Returns object to put in db
          return {host: {
              userInfo: getFields(userInfoObj, ['id', 'uri', 'display_name']), 
              topTracks: topTrackItems.map(x => x['uri']),
              tokens: {
                accessToken: encrypt(content['accessToken']),
                refreshToken: encrypt(content['refreshToken'])
              }
            },
            members: [],
            allSongs: topTrackItems.reduce((obj, x) => {
              obj[x['uri']] = 49 - topTrackItems.indexOf(x);
              return obj;
            }, {}),
            playlist: {
              uri: createPlaylistObj['uri'],
              id: createPlaylistObj['id']
            },
            _id: ID
          };

        } catch (e) {

          console.log(e);
          res.render('index', { title: 'Our Playlist', content: "Error. Please tell Bruce about this." });
          return;

        }

      })();

      await collection.insertOne(hostInfo);

    } catch (e) {
      console.log(e);
      res.render('index', { title: 'Our Playlist', content: "Error. Please tell Bruce about this." });
    } finally {
      // await client.close();
      res.render('index', { title: 'Our Playlist', content: `Use this link to add more users: ${process.env.URL_PREFIX}/members/add_member/${ID}` });
    }
  
  })(req.collection);

});

module.exports = router;
