XClass(function (xcl, XWiki) {
  var props = XWiki.model.properties;
  xcl.addProp("issueTrackerUrl", props.XString.create({
    "customDisplay": "",
    "picker": "0",
    "prettyName": "Issue Tracker URL",
    "size": "30",
    "validationMessage": "",
    "validationRegExp": ""
  }));
});