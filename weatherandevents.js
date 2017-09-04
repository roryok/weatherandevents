"use latest"
const cheerio = require("cheerio");
const request = require("request");
const moment = require("moment");
const parseString = require('xml2js').parseString;

// get weather for the next 7 days from yr.no
const getWeatherData = (weatherLocation, callback) => {
  
  let url = `http://www.yr.no/place/${weatherLocation}/forecast.xml`;  
  
  request(url, (err, response, weatherXML) => {
    if (err) callback(err);
    // parse our returned weather xml to a json object using xml2js
    parseString(weatherXML, function (err, weatherData) {      
      callback(null, weatherData)
    })
  });
}

// poll eventbrite for events in our location
const getEventsData = (country, city, start, end, eventBriteOAuthToken, callback) => {

  // we'll limit this to within 50km of our chosen city  
  let url = `https://www.eventbriteapi.com/v3/events/search/?location.address=${city + ',' 
  + country}&location.within=50km&start_date.range_start=${start.format('YYYY-MM-DDThh:mm:ss') + 'Z'}&start_date.range_end=${end.format('YYYY-MM-DDThh:mm:ss') + 'Z'}&token=${eventBriteOAuthToken}`;

  request(url, function (err, response, eventsJSON) {
    if (err) callback(err);
    // turn the returned JSON into a javascript object and return it
    callback(null, JSON.parse(eventsJSON));
  });

}

// build the Html to insert into our email
const buildHtml = (context, dates, weatherData, eventsData, cb) => {

  try {    

    let html = '';

    // loop through our date array
    for(let d in dates) {
      
      let day = dates[d]; 

      let dayHtml = ``;
      
      // Today and Tomorrow are special cases. Use the date for every other day. 
      let daytitle = (d == 0 ? 'Today' : (d == 1 ? 'Tomorrow' : day.format("dddd, MMMM Do YYYY")));

      dayHtml += `<h3>${daytitle}</h3>`

      if (weatherData && typeof weatherData.weatherdata !== 'undefined') {

        // filter weather for this day (up to four forecasts of 6 hours each)
        let daysWeather = weatherData.weatherdata.forecast[0].tabular[0].time.filter((x) => {
          return moment(x.$.from).isSame(day, 'day');
        })  

        // build a div for each forecast and include a weather symbol
        for(let weather of daysWeather)
        {
          let forecast = moment(weather.$.from).format("HH:00") + " to " + moment(weather.$.to).format("HH:00") + ": " + weather.symbol[0].$.name;
          let png = `http://roryok.com/weathericons/30/${weather.symbol[0].$.var}.png`;
          dayHtml += `<div>${forecast} <img src='${png}' style='display:inline;' /></div>`;
        }

      }

      if (typeof eventsData.events !== 'undefined') {
      
        // filter events for this day
        let daysEvents = eventsData.events.filter((x) => { 
          return moment(x.start.local).isSame(day, 'day');       
        })
        
        // build a div for each event
        for(let event of daysEvents)
        {
          dayHtml += `<h4><a href="${event.url}">${event.name.text}</a></h4>
          <span class='desc'>${(event.description.text || '').substring(0,140)}${(event.description.text || '').length > 140 ? '...' : ''}</span>`;  
        }

      }

      html += `<div>${dayHtml}</div>`;
    }
    cb(null, `<div>${html}</div>`);
  }
  catch(err) {
    cb(err);
  }
}

module.exports = (context, cb) => {

  // generate array containing the dates for the next seven days
  let dates = [];
  for(let i = 0; i < 7; i++)
  {
    // we'll turn them into moment.js objects here to make things easier later on
    let nd = moment(new Date());     
    nd.add(i, 'days'); 
    dates.push(nd); 
  }
  
  // we could use async here to set up a series of events, 
  // but since there are only two scrape functions it seemed
  // neater to just nest one inside the other

  // get our weather data from yr.no
  // context.secrets.weatherLocation must be a location in the form 'Ireland/Leinster/Dublin'
  // you can fetch this by searching for your city on yr.no and making note of the full url
  // in the case above, https://www.yr.no/place/Ireland/Leinster/Dublin/
  // unfortunately yr.no provides no API method to search for a location =(
  getWeatherData(context.secrets.weatherLocation, (err, weatherData) => {

    if (err) return cb(err);

    // get our events from eventbrite
    // eventBriteOAuthtoken is a permanent, non-expiring Oauth token which you can generate from your eventbrite account
    // this never expires, and bypasses the need to authenticate. don't share it though - anyone can access your account with it! 
    // city and country should obviously be your location, for example 'Dublin', 'Ireland'
    getEventsData(context.secrets.country, context.secrets.city, dates[0], dates[6], context.secrets.eventBriteOAuthToken, (err, eventsData) => {

      if (err) return cb(err);

      // build the html 
      buildHtml(context, dates, weatherData, eventsData, (err, html) => {

        if (err) return cb(err);

        // perform a webrequest to an IFTTT applet which sends an email. 
        if (typeof context.secrets.IFTTTUrl !== 'undefined') {          
          request(
            {
              url: context.secrets.IFTTTUrl,
              method: "POST",
              json: true,
              body: { "value1" : html }
            }, (err, response, body) => {
            if (err) return cb(err);
            return cb(null, "email sent");
          })  
        } else {
          // return the html
          return cb(null, html);    
        }

      })

    })

  })

}