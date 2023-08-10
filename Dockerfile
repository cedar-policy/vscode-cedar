FROM node:16
RUN apt-get -y update
RUN apt-get -y install --fix-missing xvfb 
RUN apt-get -y install libnss3 libatk1.0-0 libatk-bridge2.0-0 libgtk-3-0 libgbm-dev libasound2
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | bash -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"
RUN curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
WORKDIR /src
COPY <<-EOT /src/build.sh
npm install
npm run wasm-build
xvfb-run -a npm run test
npm run package
EOT
RUN chmod +x build.sh
COPY . /src/