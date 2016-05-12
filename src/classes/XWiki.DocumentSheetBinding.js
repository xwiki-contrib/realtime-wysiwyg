XClass(function (xcl, XWiki) {
  var props = XWiki.model.properties;
  xcl.addProp("sheet", props.XString.create({
    "customDisplay": "",
    "picker": "0",
    "prettyName": "Sheet",
    "size": "30",
    "validationMessage": "",
    "validationRegExp": ""
  }));
});