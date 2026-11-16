// the owner of a document can view and edit it
@id("Document-owner")
permit (
  principal is DocApp::User,
  action in [DocApp::Action::"view", DocApp::Action::"edit"],
  resource is DocApp::Document
)
when { resource.owner == principal };

// the owner of a document can share it with their own team
@id("Document-share")
permit (
  principal is DocApp::User,
  action == DocApp::Action::"share",
  resource is DocApp::Document
)
when { resource.owner == principal && principal in context.recipient };
