import fs from "fs";
import path from "path";

export function emptyFolder(folder) {
    fs.readdirSync(folder).forEach(file => {
        const filePath = path.join(folder, file);
        if (fs.lstatSync(filePath).isFile()) fs.unlinkSync(filePath);
    });
}