#!/bin/bash

for file in inferred unique mixed  duplicate
do
  echo "testing ${file}.cedar ..."
  cedar authorize -v --policies $file.cedar --entities cedarentities.json
done