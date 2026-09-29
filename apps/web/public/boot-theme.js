// Android paints the gesture bar from the first theme-color it sees, and
// often leaves that bar black until the color changes again.
addEventListener("load", function () {
  var tags = document.querySelectorAll('meta[name="theme-color"]');
  for (var i = 0; i < tags.length; i++) tags[i].setAttribute("content", "#f3efe6");
  requestAnimationFrame(function () {
    for (var i = 0; i < tags.length; i++) tags[i].setAttribute("content", "#f3efe7");
  });
});
