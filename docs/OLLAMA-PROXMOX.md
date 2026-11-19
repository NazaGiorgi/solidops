# Guía 00 — Servidor Ollama en Proxmox (Ryzen 7)

> Esto **no** es para OpenCode: lo hacés vos en Proxmox. Hacelo antes de los prompts 01 y 02.
> SolidOps sigue en el IBM M3 (sin AVX, no apto para IA). Ollama va en el servidor con Ryzen 7.

## 0. Antes de empezar

- Backup (vzdump/PBS) de las VMs/CT que ya corren en el Proxmox del Ryzen, por si crear el contenedor nuevo o tocar el firewall afecta algo.
- Si vas a activar el firewall a nivel **Datacenter** de Proxmox por primera vez, cuidado: puede cortar el acceso a la web de Proxmox (8006)
  y a las otras VMs. Activalo sólo en el CT de Ollama (paso 7, Opción A) o agregá antes las reglas de acceso a 8006/22.

## 1. Crear el contenedor

- Proxmox del Ryzen → Create CT → plantilla **Debian 12**.
- Unprivileged: sí. Núcleos: **8**. RAM: **16 GB** (24 GB si te sobra). Swap: 2 GB. Disco: **40 GB en SSD**.
- Red: **IP fija** en la LAN (de acá en adelante `IP-OLLAMA`), mismo segmento que el M3 o con ruteo hacia él.
- En LXC el contenedor ya ve el AVX2 del Ryzen. (Si en vez de LXC usás una VM: tipo de CPU **host**, si no, no ve AVX2.)

## 2. Verificar el procesador dentro del contenedor

```bash
grep -o -w 'avx2' /proc/cpuinfo | sort -u     # tiene que decir: avx2
nproc                                          # tiene que decir: 8
free -g                                        # RAM asignada
```

## 3. Instalar Ollama

```bash
apt update && apt install -y curl
curl -fsSL https://ollama.com/install.sh | sh
ollama --version
```

## 4. Configurar el servicio

```bash
systemctl edit ollama
```
Pegar:
```
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
Environment="OLLAMA_KEEP_ALIVE=24h"
Environment="OLLAMA_NUM_PARALLEL=1"
Environment="OLLAMA_MAX_LOADED_MODELS=2"
```
```bash
systemctl daemon-reload && systemctl restart ollama && systemctl status ollama --no-pager
```
- `KEEP_ALIVE=24h`: el modelo queda cargado en RAM; si no, cada consulta tarda en volver a cargarlo.
- `MAX_LOADED_MODELS=2`: mantiene cargados a la vez el de chat y el de embeddings.

## 5. Bajar los modelos

```bash
ollama pull qwen3:8b     # chat / agente (tiene soporte de herramientas)
ollama pull bge-m3       # embeddings multilingüe (español)
ollama list
```
Si la RAM queda justa, probá una variante más chica de qwen3 (ver `ollama.com/library/qwen3`).

## 6. Prueba local en el servidor

```bash
# Chat (anotá los segundos que tarda)
time ollama run qwen3:8b "Respondé en una frase: ¿qué es un switch de red?" --verbose
# El --verbose muestra "eval rate" = tokens por segundo. Anotalo.

# Embeddings
curl -s http://localhost:11434/api/embed -d '{"model":"bge-m3","input":"impresora del laboratorio no imprime"}' | head -c 200
```

## 7. Firewall (OBLIGATORIO: Ollama no tiene usuario ni contraseña)

Permitir el puerto 11434 **sólo** desde:
- la IP del servidor/VM donde corre SolidOps en el **IBM M3** (`IP-SOLIDOPS-PROD`)
- la IP de tu **notebook** (`IP-NOTEBOOK`)

Opción A — Firewall de Proxmox, sólo en el CT (en el CT → Firewall → Add; ver advertencia del paso 0 antes de habilitarlo en Datacenter):
- IN, ACCEPT, source `IP-SOLIDOPS-PROD`, dest port 11434, proto tcp
- IN, ACCEPT, source `IP-NOTEBOOK`, dest port 11434, proto tcp
- IN, DROP, dest port 11434 (regla final)
- Activar el firewall en la interfaz de red del CT y en el CT (Options → Firewall: Yes).

Nunca hacer port-forward de 11434 en el router ni publicarlo a internet.

## 8. Prueba desde las otras máquinas

```bash
# Desde la VM de SolidOps en el M3:
curl -s http://IP-OLLAMA:11434/api/tags
# Desde tu notebook (PowerShell):
curl.exe -s http://IP-OLLAMA:11434/api/tags
# Desde una IP NO autorizada: tiene que fallar (timeout o rechazado).
```

> Si la notebook no está en la misma red que el Ryzen (por ejemplo, trabajás desde tu casa), necesitás la VPN de la oficina
> para llegar a `IP-OLLAMA`. Sin eso, el prompt 01 te va a mostrar "Ollama no disponible".

## 9. Anotar para los prompts

| Dato | Valor |
|---|---|
| IP-OLLAMA | |
| Versión de Ollama | |
| Tokens/seg de qwen3:8b (paso 6) | |
| RAM libre con los 2 modelos cargados (`free -g`) | |
| IP-SOLIDOPS-PROD | |
| IP-NOTEBOOK | |

## 10. Backup del contenedor

- Apenas termines y pruebes el paso 8: **backup vzdump del CT** (queda una versión que funciona para volver si algo se rompe).
- Agregarlo al job de backup periódico de Proxmox (vzdump/PBS).
- Antes de actualizar Ollama o cambiar de modelo: snapshot del CT. Si la versión nueva anda mal, se vuelve al snapshot.
- Los modelos pesan varios GB; si no los querés en el backup, se vuelven a bajar con `ollama pull`.
