FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV PORT=8080
ENV OCTAVE_PATH=/usr/bin/octave-cli
ENV GNUTERM=dumb

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       octave \
       gnuplot-nox \
       ghostscript \
       fonts-freefont-otf \
       ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --create-home --shell /usr/sbin/nologin smat \
    && mkdir -p /app /tmp/smat-home \
    && chown -R smat:smat /app /tmp/smat-home

WORKDIR /app

COPY --chown=smat:smat cloud-api.js ./cloud-api.js

USER smat

EXPOSE 8080

CMD ["node", "cloud-api.js"]