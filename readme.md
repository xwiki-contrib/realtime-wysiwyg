# Realtime WYSIWYG Editor Binding

This binding makes use of the [chainpad] realtime editor engine and binds
to the [XWiki WYSIWYG] editor. It is currently a work-in-progress but to try it out,
install use the [XWiki Realtime Backend] from the Extension Manager and build the .xar file
as follows:

    # first make sure you have an up-to-date version of xwiki-tools
    npm install -g xwiki-tools

    # then run the builder
    ./do

    # and import the resulting XAR file.

Alternatively you can build and import in one operation using:

    ./do --post Admin:admin@mywikidomain.name:8080/xwiki

Or generate a Maven compatible build using:

    ./do --mvn


[chainpad](https://github.com/xwiki-contrib/chainpad)
[XWiki WYSIWYG](http://extensions.xwiki.org/xwiki/bin/view/Extension/WYSIWYG+Editor+Module)
[XWiki Realtime Backend](http://extensions.xwiki.org/xwiki/bin/view/Extension/RtBackend)
