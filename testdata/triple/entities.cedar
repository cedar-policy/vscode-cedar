// @formatter:off

// test beginning of blank line
p
f
w
u

// test principal/action/resource on the same line
permit (principal == , action == , resource == );

// test principal/action/resource on the same line
permit (principal == ,
  action == ,
  resource == 
);

// test principal properties
permit (principal, action, resource)
when { principal. };