var express = require('express');
var app=express();
var port=process.env.PORT||8080;
var fs=require("fs");
var bodyParser = require('body-parser');
var url=require("url");
var querystring=require("querystring");
var session=require("express-session");
var http=require('http');
var https=require('https');
var imageType=require('image-type');
var request=require('request');

const key=require("./key.json");        //key information such as twitter OAuth key and database url and cookie secret

const apiURL="https://www.googleapis.com/books/v1/volumes?q=";



//---------------------------------mongodb setup------------------------------------
var mongo=require("mongodb");
var monk=require("monk");
var dburl=key.dburl;  //dburl will be the second argument
const db=monk(dburl);
const collectionName="ezbook"

//----------------------passport authentication setup------------------------
var passport=require('passport');
var TwitterStrategy = require('passport-twitter').Strategy;
app.use(session({
  secret: key.sessionSecret,
  resave: true,
  saveUninitialized: false
}));
app.use(passport.initialize())
app.use(passport.session())

passport.use('twitter',new TwitterStrategy(key.twitterKey,function(token, tokenSecret, profile, done){
  process.nextTick(function(){
    db.collection(collectionName).find({id:profile.id},function(err,data){
      if(err){
        done(err,null);
        throw err;
      }
      if(data.length!=0){   //if user exist, synchronize user profile and then continue with that profile.
        data[0].username=profile.username;
        data[0].iconURL=profile["_json"].profile_image_url;
        db.collection(collectionName).update({id:profile.id},data[0]);
        done(null,data[0]);
      }
      else{     //else create a new account
        var newProf={};
        newProf.id=profile.id;
        newProf.username=profile.username;
        newProf.iconURL=profile["_json"].profile_image_url;
        newProf.book=[];
        newProf.fromReq=[];     //the requests initated by the user
        newProf.toReq=[];       //the requests initiated by other user to the book owner
        newProf.maxid=0;
        
        //personal information
        newProf.name="";
        newProf.city="";
        newProf.country="";
        
        db.collection(collectionName).insert(newProf,function(err){
          if(err){
            done(err,null);
            throw err;
          }
          
          done(null,newProf);
        });
      }
    });
    
  });
  
}));

passport.serializeUser(function (user, done) {
	done(null, user.id);
});

passport.deserializeUser(function (id, done) {
    db.collection(collectionName).find({id:id},function(err,user){
      if(err){
        done(err,null);
        throw err;
      }
      done(null,user[0]);
    });
});

//------------------------------end of setting up passport authentication-----------------------


//---------------------------------------user functions-----------------------------------------
function ifImgValid(url,succ,fail){          //check if a url is a valid image. If yes, call succ, else call fail
    if(url.substring(0,7)=="http://"){
        http.get(url, function (res) {
            res.once('data', function (chunk) {
                res.destroy();
                if(imageType(chunk))succ();
                else fail();
            });
        }).on('error',function(){
          fail();
        })
    }
    else if(url.substring(0,8)=="https://"){
        https.get(url, function (res) {
            res.once('data', function (chunk) {
                res.destroy();
                if(imageType(chunk))succ();
                else fail();
            });
        }).on('error',function(){
          fail();
        })
    }
    else fail();
}

function isValid(str) { return /^\w+$/.test(str); };      //the function that checks if a string is purely composed of number and alphabets

//-------------------------------routing--------------------------------------------------------
app.set("views",__dirname+"/client");
app.set("view engine","jade");

app.use(express.static(__dirname+'/client'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.get('/',function(req,res){
  //we will build the list of all pins
  db.collection(collectionName).find({},function(err,data){
    if(err) throw err;
    var list=[];
    for(var i=0;i<data.length;i++){
      for(var j=0;j<data[i].book.length;j++){
        var requested=false;
        if(req.user){
          var requested=req.user.fromReq.find(function(r){
            return (r.to==data[i].id)&&(r.bookid==data[i].book[j].id)
          });
          if(requested){
            requested=true;
          }
          else requested=false;
        }
        
        
        
        list.push({
          id: data[i].id,
          username: data[i].username,
          iconURL: data[i].iconURL,
          title: data[i].book[j].title,
          url: data[i].book[j].url,
          bookid: data[i].book[j].id,
          requested: requested
        });
      }
    }
    
    res.render("index",{
      user: req.user,
      books: list
    });
  });
});

app.get('/signin',passport.authenticate('twitter'));

app.get('/signin/callback',passport.authenticate('twitter', {
  successRedirect : '/',
  failureRedirect : '/signin'
}));

app.get('/signout',function(req,res){
  req.logout();
  res.redirect('/');
})

app.get('/newbook',function(req,res){
  if(!req.user){
    res.redirect('/signin');
    return;
  }
  res.render("newbook",{
    user: req.user,
    err: querystring.parse(url.parse(req.url).query).err
  });
});


app.post('/newbook',function(req,res){
  if(!req.user){
    res.redirect('/signin');
    return;
  }
  
  var title=req.body.title;
  
  if(title==undefined){
    res.render('newbook',{
      user: req.user,
      err: "invalid"
    });
    return;
  }
  
  request(apiURL+title,function(err,response,body){
    if(err) throw err;
    
    body=JSON.parse(body);
    
    if(body.totalItems==0){   //no book being found
        res.render('newbook',{
          user: req.user,
          err: "invalid"
        });
        return;
    }
    
    var imageURL=(body.items[0].volumeInfo.imageLinks&&body.items[0].volumeInfo.imageLinks.thumbnail)?body.items[0].volumeInfo.imageLinks.thumbnail:null;   //make sure the url is an string so that ifImgValid does not crash
    var actualTitle=body.items[0].volumeInfo.title + (body.items[0].volumeInfo.subtitle?(" - " + body.items[0].volumeInfo.subtitle):"");
    
    db.collection(collectionName).find({id:req.user.id},function(err,data){
      if(err) throw err;
      
      if(data.length==0){       //impossible! if u have an user profile in cookie then u probably already have a profile in db
        res.redirect('/signin');
        return;
      }
      
      var profile=data[0];
      profile.book.push({
        id: profile.maxid,
        title: actualTitle,
        url: imageURL
      });
      profile.maxid++;
      
      db.collection(collectionName).update({id:profile.id},profile);
      res.redirect('/');
      return;
    });
    
  });
  
  
});

app.get('/book',function(req,res){
  var id=querystring.parse(url.parse(req.url).query).id;
  db.collection(collectionName).find({id:id},function(err,data){
    if(err)throw err;
    
    if(data.length==0){   //if the user does not exist which should not happen at all!
      res.redirect('/');
      return;
    }
    
    var profile=data[0];
    var list=[];
    for(var i=0;i<profile.book.length;i++){
      var requested=false
      
      if(req.user){
        requested=req.user.fromReq.find(function(r){
          return (r.to==profile.id)&&(r.bookid==profile.book[i].id)
        });
        if(requested){
          requested=true;
        }
        else requested=false;
      }
      
      
      
      
      
      list.push({
        id: profile.id,
        username: profile.username,
        iconURL: profile.iconURL,
        title: profile.book[i].title,
        url: profile.book[i].url,
        bookid: profile.book[i].id,
        requested: requested
      });
    }
    
    
    res.render("book",{
      id: id,
      user: req.user,
      profile: profile,
      books: list
    });
  });
})

app.get('/delete',function(req,res){
  var id=querystring.parse(url.parse(req.url).query).id;
  var bookid=querystring.parse(url.parse(req.url).query).bookid;
  if(!(req.user&&req.user.id&&req.user.id==id)){
    res.redirect('/signin');
    return;
  }
  db.collection(collectionName).find({id:id},function(err,data){
    if(err){
      throw err;
    }
    if(data.length==0){     //should not happen
      res.redirect('/');
      return;
    }
    
    var profile=data[0];
    
    var book;
    for(var i=0;i<profile.book.length;i++){       //we first remove the book itself 
      if(profile.book[i].id==bookid){
        book=profile.book.splice(i,1);
        book=book[0];
        break;
      }
    }
    
    //then we remove the correspoding torequest
    var newToReq=[];
    var removeReq=[];
    for(i=0;i<profile.toReq.length;i++){
      if(profile.toReq[i].bookid!=book.id){   //if it is not a request to the current book deleted, keep it
        newToReq.push(profile.toReq[i]);
      }
      else{
        removeReq.push(profile.toReq[i]);
      }
    }

    profile.toReq=newToReq;
    db.collection(collectionName).update({id:id},profile);
    
    //remove the the to reqs in other users
    for(i=0;i<removeReq.length;i++){
      db.collection(collectionName).find({id: removeReq[i].from},function(err,data){
        if(err) throw err;
        if(data.length==0){
          return;
        }
        
        var user=data[0];
        var target=req.user;
        
        var newFromReq=[];
        
        for(var j=0;j<user.fromReq.length;j++){
          if(!((user.fromReq[j].to==target.id)&&(user.fromReq[j].bookid==book.id))){   //if the target of the request is the book to delete, remove the book
            newFromReq.push(user.fromReq[j]);
          }
        }
        
        user.fromReq=newFromReq;
        db.collection(collectionName).update({id:user.id},user);
      });
    }
    
    
    res.redirect('/book?id='+id);
    return;
  });
});


app.get('/request',function(req,res){      //when someone initiate an request
  if(!req.user){
    res.redirect('/signin');
    return;
  }
  
  var fromid=req.user.id;
  var toid=querystring.parse(url.parse(req.url).query).id;
  var bookid=querystring.parse(url.parse(req.url).query).bookid;
  var src=querystring.parse(url.parse(req.url).query).src;
  var title=querystring.parse(url.parse(req.url).query).title;
  
  if(toid==fromid){       //just in case someone is messing around with trying to request his own book
    res.redirect('/');
    return;
  }
  
  var requestObj={
    from: fromid,
    fromName: req.user.username,
    to: toid,
    bookid: bookid,
    title: title
  }
  
  db.collection(collectionName).find({id:fromid},function(err,data){      //update the the request source
    if(err){
      throw err;
    }
    
    if(data.length==0){   //there is something wrong! should never happen
      res.redirect('/');
      return;
    }
    
    var profile=data[0];
    
    for(var i=0;i<profile.fromReq.length;i++){    //make sure no repeated request can be made to a book by an user
      if(profile.fromReq[i].bookid==bookid && profile.fromReq[i].to==toid){
        if(src=='index'){
          res.redirect('/');
          return;
        }
        else{
          res.redirect('/book?id='+toid);
          return;
        }
      }
    }
    
    
    db.collection(collectionName).find({id:toid},function(err,data){      //update the request target
      if(err){
        throw err;
      }
      
      if(data.length==0){   //there is something wrong! should never happen
        res.redirect('/');
        return;
      }
      
      
      var newprofile=data[0];
      requestObj.toName=newprofile.username;
      
      profile.fromReq.push(requestObj);
    
      db.collection(collectionName).update({id: fromid},profile);
    
      newprofile.toReq.push(requestObj);
      
      db.collection(collectionName).update({id: toid},newprofile);
      
      if(src=='index'){
        res.redirect('/');
        return;
      }
      else{
        res.redirect('/book?id='+toid);
        return;
      }
      
    });
  });
  
});



app.get('/respond',function(req,res){       //respond to an request as either 'Y' or 'N'
  var from=querystring.parse(url.parse(req.url).query).from;
  var to=querystring.parse(url.parse(req.url).query).to;
  var bookid=querystring.parse(url.parse(req.url).query).bookid;
  var decision=querystring.parse(url.parse(req.url).query).d;
  
  if(decision=='Y' && req.user.id!=to){     //a guy who is not the request reciver accept the request, not valid!
    res.redirect('/');
    return;
  }
  
  if(decision=='N' && (req.user.id!=from && req.user.id!=to)){    //a random guy denied the request, not valid!
    res.redirect('/');
    return;
  }
  
  if(decision!='Y'&&decision!='N'){     //not a valid answer!
    res.redirect('/');
    return;
  }
  
  
  db.collection(collectionName).find({id:from},function(err,data){
    if(err)throw err;
    
    if(data.length==0){
      console.log('1');
      res.redirect('/book?id='+req.user.id);
      return;
    }
    
    var profile=data[0];
    var found=false;
    
    for(var i=0;i<profile.fromReq.length;i++){
      if(profile.fromReq[i].from==from && profile.fromReq[i].to==to && profile.fromReq[i].bookid==bookid){    //if such request exist
        profile.fromReq.splice(i,1);
        found=true;
        break;
      }
    }
    
    if(!found){
      console.log('2');
      res.redirect('/book?id='+req.user.id);
      return;
    }
    
    db.collection(collectionName).find({id:to},function(err,data){
      if(err)throw err;
      
      if(data.length==0){
        console.log('3');
        res.redirect('/book?id='+req.user.id);
        return;
      }
      
      var toProfile=data[0];
      
      var found=false;
      
      for(var i=0;i<toProfile.toReq.length;i++){
        if(toProfile.toReq[i].from==from && toProfile.toReq[i].to==to && toProfile.toReq[i].bookid==bookid){    //if such request exist
          toProfile.toReq.splice(i,1);
          found=true;
          break;
        }
      }
      
      if(!found){
        console.log('4');
        res.redirect('/book?id='+req.user.id);
        return;
      }
      
      
      
      if(decision=='Y'){
        var book=null;
        for(i=0;i<toProfile.book.length;i++){
          if(toProfile.book[i].id==bookid){   //book found. take it out.
            book=toProfile.book.splice(i,1);
            break;
          }
        }
        
        if(book==null){
          console.log('5');
          res.redirect('/book?id='+req.user.id);
          return;
        }
        book=book[0];
        
        book.id=profile.maxid++;
        profile.book.push(book);
      }
      
      //now we update everything and go back to 'my book'
      db.collection(collectionName).update({id: from},profile);
      db.collection(collectionName).update({id: to},toProfile);
      
      res.redirect('/book?id='+req.user.id);
      return;
    });
    
  });
  
  
});



app.get('/update',function(req,res){
  if(!req.user){
    res.redirect('/signin');
    return;
  }
  
  res.render('update',{
    user: req.user
  });
});


app.post('/update',function(req,res){
  var name=req.body.name;
  var city=req.body.city;
  var country=req.body.country;
  
  if(name==undefined||city==undefined||country==undefined||(!req.user)){   //only intentional post request can invoke this. not valid
    res.redirect('/');
    return;
  }
  
  req.user.name=name;
  req.user.city=city;
  req.user.country=country;
  
  db.collection(collectionName).update({id:req.user.id},req.user);
  
  res.redirect('/book?id='+req.user.id);
})

app.listen(port,function(){
  console.log("the app is listening on port "+port);
});
