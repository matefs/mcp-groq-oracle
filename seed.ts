import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";
import { rmSync } from "node:fs";

const path = fileURLToPath(new URL("./app.db", import.meta.url));
rmSync(path, { force: true });
const db = new Database(path);
db.exec(`
CREATE TABLE clientes (id INTEGER PRIMARY KEY, nome TEXT, cidade TEXT, criado_em TEXT);
CREATE TABLE produtos (id INTEGER PRIMARY KEY, nome TEXT, preco REAL, categoria TEXT);
CREATE TABLE pedidos (id INTEGER PRIMARY KEY, cliente_id INTEGER REFERENCES clientes(id), produto_id INTEGER REFERENCES produtos(id), quantidade INTEGER, data TEXT);
INSERT INTO clientes VALUES (1,'Ana Silva','São Paulo','2024-01-10'),(2,'Bruno Costa','Rio de Janeiro','2024-02-15'),(3,'Carla Souza','Curitiba','2024-03-20'),(4,'Diego Lima','São Paulo','2024-04-05');
INSERT INTO produtos VALUES (1,'Notebook',4500,'Eletrônicos'),(2,'Mouse',80,'Acessórios'),(3,'Teclado',250,'Acessórios'),(4,'Monitor',1200,'Eletrônicos');
INSERT INTO pedidos VALUES (1,1,1,1,'2024-05-01'),(2,1,2,2,'2024-05-03'),(3,2,4,1,'2024-05-10'),(4,3,3,3,'2024-06-01'),(5,4,1,2,'2024-06-15'),(6,2,2,5,'2024-07-01');
`);
console.log("app.db criado");
