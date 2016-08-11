const toggleSpeed=200
function toggleList(){
  $("#userList").slideToggle(toggleSpeed);
}

function toggleFrom(){
  $(".fromReqBar").slideToggle(toggleSpeed);
}

function toggleTo(){
  $(".toReqBar").slideToggle(toggleSpeed);
}

$(window).on('load',function(){
    $('.pin-wall').masonry({
        columnWidth: '.pin',
        itemSelector: '.pin'
    });
})