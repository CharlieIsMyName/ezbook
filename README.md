# ezbook
A full stack javascript book trading app. Allow the users to exchange their books with others on the site.

# Usage - How to run the server
```
node server.js 
```

The app must contain a key.json file, which have the twitter app key information in the following format since this app uses twitter authentication(OAuth). It should also contain mongodb location information and a session secret.

```json
{
    "twitterKey": {
      "consumerKey": "a",
      "consumerSecret": "b",
      "callbackURL": "c"
    },
    "dburl": "d",
    "sessionSecret": "e"
}
```

the callbackURL must match the one you registered with.

#Project information

-Currently depolyed on https://myezbook.herokuapp.com/


-Original project requirement: https://www.freecodecamp.com/challenges/manage-a-book-trading-club


-Many thanks to google book API which made this project possible
