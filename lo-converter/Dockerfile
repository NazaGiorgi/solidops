# lo-converter — servicio de conversión Office->PDF con LibreOffice headless.
# Imagen basada en Alpine con LibreOffice instalado (solo lo necesario).
FROM alpine:3.19

# Instalar node (para el server.js) y libreoffice (para la conversión).
# LibreOffice en Alpine: paquete `libreoffice` (full) o `libreoffice-core` +
# filtros. Usamos `libreoffice` con el filtro writer/calc/impress.
RUN apk add --no-cache --update \
      nodejs npm \
      libreoffice \
      libreoffice-lang-es \
      ttf-dejavu \
    && rm -rf /var/cache/apk/*

WORKDIR /app
COPY server.js .

EXPOSE 8000
CMD ["node", "server.js"]
