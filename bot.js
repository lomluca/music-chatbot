/* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
           ______     ______     ______   __  __     __     ______
          /\  == \   /\  __ \   /\__  _\ /\ \/ /    /\ \   /\__  _\
          \ \  __<   \ \ \/\ \  \/_/\ \/ \ \  _"-.  \ \ \  \/_/\ \/
           \ \_____\  \ \_____\    \ \_\  \ \_\ \_\  \ \_\    \ \_\
            \/_____/   \/_____/     \/_/   \/_/\/_/   \/_/     \/_/
            
This is the DOREMUS Slack Bot! Built with Botkit, using the Dialogflow middleware.

Authors:
  - Luca LOMBARDO
  - Claudio SCALZO
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */

// CHECKS FOR THE SLACK AND DIALOGFLOW TOKENS
if (!process.env.token) {
    console.log('Error: Specify token in environment');
    process.exit(1);
}

if (!process.env.dialogflow) {
    console.log('Error: Specify dialogflow in environment');
    process.exit(1);
}


// VARIABLES DECLARATION
var Botkit = require('botkit');
var FuzzySet = require('fuzzyset.js');
var request = require('request');
var http = require('http');
var bot_options = {
    clientId: process.env.clientId,
    clientSecret: process.env.clientSecret,
    //debug: true,
    scopes: ['bot'],
};
var slackController = Botkit.slackbot(bot_options);
var slackBot = slackController.spawn({
    token: process.env.token,
});
var dialogflowMiddleware = require('botkit-middleware-dialogflow')({
    token: process.env.dialogflow,
});
var alreadyAskedCount = 0

// LOAD IN MEMORY ORIGINAL NAMES TO HANDLE MISSPELLED ONES
var misspellingSolver = FuzzySet();
var lineReader = require('readline').createInterface({
  input: require('fs').createReadStream('names.txt')
});
lineReader.on('line', function (line) {
  misspellingSolver.add(line);
});

// LOAD IN MEMORY POPULARITY INFORMATION
var popularityDictionary = {};
var lineReader = require('readline').createInterface({
  input: require('fs').createReadStream('popularity.csv')
});
lineReader.on('line', function (line) {
  var fields = line.split(','); 
  popularityDictionary[fields[0]] = fields[1];
});

// INITs
slackController.middleware.receive.use(dialogflowMiddleware.receive);
slackBot.startRTM();


// WORKS-BY-ARTIST INTENT
slackController.hears(['works-by-artist'], 'direct_message, direct_mention, mention', dialogflowMiddleware.hears, function(bot, message) {
  
  // ACTION COMPLETE (the artist name has been provided)
  if (message['nlpResponse']['result']['actionIncomplete'] == false) {
    
    alreadyAsked = false
    alreadyAskedCount = 0
    
    console.log(message.entities)
    
    // GET PARAMETERS
    var artist = message.entities["doremus-artist-ext"];
    var number = message.entities["number"];
    var instruments = message.entities["doremus-instrument"];
    var strictly = message.entities["doremus-strictly"];
    var year = message.entities["date-period"];
    
    var startyear = null;
    var endyear = null;
    // IF YEAR IS PRESENT
    if (year !== "") {
      startyear = parseInt(year.split("/")[0]);
      endyear = parseInt(year.split("/")[1]);
    }
    
    // CHECK IF INSTRUMENT IS PRESENT
    if (instruments && instruments.length > 0) {
      
      // DO THE QUERY (WITH ALL THE INFOS)
      doQuery(artist, number, instruments, strictly, startyear, endyear, bot, message);
    }
    else {
      
      // SEND THE BOT RESPONSE ("Do you want to filter by instruments?")
      bot.reply(message, message['fulfillment']['speech']);
    }
  }
  
  // ACTION INCOMPLETE (the artist names hasn't been provided or it was misspelled)
  else {
    
    // MISSING ARTIST NAME
    // -> check for misspelling and ask for the most similar (over threshold)
    // -> otherwise forward the question sent by DialogFlow ("For which artist?")
    
    // Retrieve the misspelled string
    var misspelled = message.entities["any"];
    
    // If contains something...
    if (misspelled != '') {
      
      // ...make prettier the Dialogflow response ("Who is the artist?")
      var response = getSimilarArtistNames(misspelled);
      
      if (response === "error") {
        bot.reply(message, "Sorry, there was a problem! Retry later.");
      }
      else {
        response += "So, for which artist?";
        bot.reply(message, response);
      }
    }
    // if the string doesn't contain anything, send the NLP question
    else {
      console.log(message);
      if (alreadyAskedCount == 0) {
        bot.reply(message, message['fulfillment']['speech']);
        alreadyAskedCount++;
      } else if (alreadyAskedCount == 1) {
        var response = getSimilarArtistNames(message.text);
        /*
        if (response === "error") {
          bot.reply(message, "Sorry, there was a problem! Retry later.");
        }*/
        alreadyAskedCount++
        response += "So, for which artist?";
        bot.reply(message, response);
      } else {
        bot.reply(message, "Sorry, I couldn't find your artist.");
        sendClearContext(message["nlpResponse"]["sessionId"]);
      }
    }
  }
});

// WORKS-BY-ARTIST YES FOLLOW-UP
slackController.hears(['works-by-artist - yes'], 'direct_message, direct_mention, mention', dialogflowMiddleware.hears, function(bot, message) {
  
  // IF YES HAS BEEN WRITTEN, WITH INSTRUMENTS PROVIDED
  if (message['nlpResponse']['result']['actionIncomplete'] == false) {
    
    var parentContext = message["nlpResponse"]["result"]["contexts"][0];
    var startyear;
    var endyear;
    
    // GET PARAMETERS
    var artist = parentContext["parameters"]["doremus-artist-ext"];
    var number = parentContext["parameters"]["number"];
    var instrument = message.entities["doremus-instrument"];
    var strictly = message.entities["doremus-strictly"];
    var year = parentContext["parameters"]["date-period"];
    
    // IF YEAR IS PRESENT
    if (year !== "") {
      startyear = parseInt(year.split("/")[0]);
      endyear = parseInt(year.split("/")[1]);
    }
    else {
      startyear = null;
      endyear = null;
    }
    
    // DO THE QUERY (WITH ALL THE INFOS)
    doQuery(artist, number, instrument, strictly, startyear, endyear, bot, message);
  }
  
  // IF YES HAS BEEN SAID, BUT NO INSTRUMENTS PROVIDED
  else {
      
      // SEND THE BOT RESPONSE ("Ok! For which instruments?")
      bot.reply(message, message['fulfillment']['speech']);
  }
});

// WORKS-BY-ARTIST NO FOLLOW-UP
slackController.hears(['works-by-artist - no'], 'direct_message, direct_mention, mention', dialogflowMiddleware.hears, function(bot, message) {
  
  var parentContext = message["nlpResponse"]["result"]["contexts"][0];
  var startyear;
  var endyear;

  // GET PARAMETERS
  var artist = parentContext["parameters"]["doremus-artist-ext"];
  var number = parentContext["parameters"]["number"];
  var year = parentContext["parameters"]["date-period"];
    
  // IF YEAR IS PRESENT
  if (year !== "") {
    startyear = parseInt(year.split("/")[0]);
    endyear = parseInt(year.split("/")[1]);
  }
  else {
    startyear = null;
    endyear = null;
  }

  // DO THE QUERY (WITH ALL THE INFOS EXCEPT INSTRUMENTS)
  doQuery(artist, number, null, "", startyear, endyear, bot, message);

});

// DISCOVER ARTIST
slackController.hears(['discover-artist'], 'direct_message, direct_mention, mention', dialogflowMiddleware.hears, function(bot, message) {
  
  // ACTION COMPLETE (we have all the required infos)
  if (message['nlpResponse']['result']['actionIncomplete'] == false) {
    
    // SEND THE BIO TO THE USER
    answerBio(bot, message, message.entities["doremus-artist-ext"]);
  }
  
  // ACTION INCOMPLETE (the artist names hasn't been provided or it was misspelled)
  else {
    
    // MISSING ARTIST NAME
    // -> check for misspelling and ask for the most similar (over threshold)
    // -> otherwise forward the question sent by DialogFlow ("For which artist?")
    
    // Retrieve the misspelled string
    var misspelled = message.entities["any"];
    
    // If contains something...
    if (misspelled != '') {
      
      // ...make prettier the Dialogflow response ("Who is the artist?")
      var response = "Sorry, I didn't found him! I give you some hints:\n";
      
      // ...get the 3 most similar artist names and propose them to the user
      var result = misspellingSolver.get(misspelled);
      if (response === "error") {
        bot.reply(message, "Sorry, there was a problem! Retry later.");
      }
      else {
        for (var i = 0; i < 3 && i < result.length; i++)
            response += "- " + result[i][1] + "\n";

        response += "So, for which artist?";

        bot.reply(message, response);
      }
    }
    // if the string doesn't contain anything, send the NLP question
    else {
      
      bot.reply(message, message['fulfillment']['speech']);
    }
  }
  
});

// WORKS-BY-DISCOVERED-ARTIST INTENT
slackController.hears(['works-by-discovered-artist'], 'direct_message, direct_mention, mention', dialogflowMiddleware.hears, function(bot, message) {
  
    // GET PARAMETERS
    var artist = message.entities["doremus-artist-ext"];
    var number = message.entities["number"];
    var instruments = message.entities["doremus-instrument"];
    var strictly = message.entities["doremus-strictly"];
    var year = message.entities["date-period"];
    
    var startyear = null;
    var endyear = null;
    // IF YEAR IS PRESENT
    if (year !== "") {
      startyear = parseInt(year.split("/")[0]);
      endyear = parseInt(year.split("/")[1]);
    }
  
    // CHECK IF INSTRUMENT IS PRESENT
    if (instruments && instruments.length > 0 ) {
      // DO THE QUERY (WITH ALL THE INFOS)
      doQuery(artist, number, instruments, strictly, startyear, endyear, bot, message);
    }
    else {
      // SEND THE BOT RESPONSE ("Do you want to filter by instruments?")
      bot.reply(message, message['fulfillment']['speech']);
    }
      
});

// WORKS-BY-DISCOVERED-ARTIST YES FOLLOW-UP
slackController.hears(['works-by-discovered-artist - yes'], 'direct_message, direct_mention, mention', dialogflowMiddleware.hears, function(bot, message) {
  
  // IF YES HAS BEEN WRITTEN, WITH INSTRUMENTS PROVIDED
  if (message['nlpResponse']['result']['actionIncomplete'] == false) {
    
    var parentContext = message["nlpResponse"]["result"]["contexts"][0]
    
    // GET PARAMETERS
    var artist = parentContext["parameters"]["doremus-artist-ext"];
    var number = parentContext["parameters"]["number"];
    var instrument = message.entities["doremus-instrument"];
    var strictly = message.entities["doremus-strictly"];
    var year = parentContext["parameters"]["date-period"];
    
    var startyear = null;
    var endyear = null;
    // IF YEAR IS PRESENT
    if (year !== "") {
      startyear = parseInt(year.split("/")[0]);
      endyear = parseInt(year.split("/")[1]);
    }
    
    // DO THE QUERY (WITH ALL THE INFOS)
    doQuery(artist, number, instrument, strictly, startyear, endyear, bot, message);
  }
  
  // IF YES HAS BEEN SAID, BUT NO INSTRUMENTS PROVIDED
  else {
      
      // SEND THE BOT RESPONSE ("Ok! For which instruments?")
      bot.reply(message, message['fulfillment']['speech']);
  }
});

// WORKS-BY-DISCOVERED-ARTIST NO FOLLOW-UP
slackController.hears(['works-by-discovered-artist - no'], 'direct_message, direct_mention, mention', dialogflowMiddleware.hears, function(bot, message) {
  
  var parentContext = message["nlpResponse"]["result"]["contexts"][0]

  // GET PARAMETERS
  var artist = parentContext["parameters"]["doremus-artist-ext"];
  var number = parentContext["parameters"]["number"];
  var year = parentContext["parameters"]["date-period"];
  
  var startyear = null;
  var endyear = null;
  // IF YEAR IS PRESENT
  if (year !== "") {
    startyear = parseInt(year.split("/")[0]);
    endyear = parseInt(year.split("/")[1]);
  }

  // DO THE QUERY (WITH ALL THE INFOS EXCEPT INSTRUMENTS)
  doQuery(artist, number, null, "", startyear, endyear, bot, message);

});


// PROPOSE-PERFORMANCE
slackController.hears(['propose-performance'], 'direct_message, direct_mention, mention', dialogflowMiddleware.hears, function(bot, message) {
  
  // ACTION COMPLETE (the artist name has been provided)
  if (message['nlpResponse']['result']['actionIncomplete'] == false) {
    
    
    // DO THE QUERY (WITH ALL THE INFOS)
    doQueryPerformance(bot, message);
  }
  
  // ACTION INCOMPLETE (the artist names hasn't been provided or it was misspelled
  else {

    bot.reply(message, message['fulfillment']['speech']);
  }
});



// HELLO INTENT
slackController.hears(['hello-intent'], 'direct_message, direct_mention, mention', dialogflowMiddleware.hears, function(bot, message) {
  
  bot.reply(message, message['fulfillment']['speech']);
});


// DEFAULT INTENT
slackController.hears(['Default Fallback Intent'], 'direct_message, direct_mention, mention', dialogflowMiddleware.hears, function(bot, message) {
  
  bot.reply(message, message['fulfillment']['speech']);
});
