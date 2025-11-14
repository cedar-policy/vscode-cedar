FROM node:20
RUN apt-get -y update
RUN apt-get -y install --fix-missing xvfb 
RUN apt-get -y install libnss3 libatk1.0-0 libatk-bridge2.0-0 libgtk-3-0 libgbm-dev libasound2
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | bash -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"
ENV XDG_RUNTIME_DIR=/run/user/0
ENV DBUS_SESSION_BUS_ADDRESS=unix:path=$XDG_RUNTIME_DIR/bus
RUN mkdir $XDG_RUNTIME_DIR && chmod 700 $XDG_RUNTIME_DIR && chown root:root $XDG_RUNTIME_DIR
WORKDIR /src
COPY <<-EOT /src/build.sh
# commands before `xvfb-run -a npm run test` avoid these ERROR messages:
# - Failed to connect to the bus: Could not parse server address: Unknown address type (examples of valid types are "tcp" and on UNIX "unix")
# - Exiting GPU process due to errors during initialization
service dbus start
dbus-daemon --session --address=$DBUS_SESSION_BUS_ADDRESS --nofork --nopidfile --syslog-only &
mkdir ~/.vscode && echo '{ "disable-hardware-acceleration": true }' > ~/.vscode/argv.json
# Build and Test
npm ci
rustup update stable && rustup default stable
cargo install wasm-pack --version 0.13.1
npm run wasm-build
npm run compile
xvfb-run -a npm run test
npm run package
EOT
RUN chmod +x build.sh
COPY . /src/