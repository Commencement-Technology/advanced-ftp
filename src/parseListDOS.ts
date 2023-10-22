import { FileInfo, FileType } from "./FileInfo"

/**
 * This parser is based on the FTP client library source code in Apache Commons Net provided
 * under the Apache 2.0 license. It has been simplified, modified and rewritten to better fit the Javascript language.
 *
 * https://github.com/apache/commons-net/blob/master/src/main/java/org/apache/commons/net/ftp/parser/NTFTPEntryParser.java
 */

const RE_LINE = new RegExp(
    "((?:(\\d{1,2})\\.(\\d{1,2})\\.(\\d{1,4}))|(?:(\\d{1,2})-(\\d{1,2})-(\\d{1,4}))|(?:(\\d{1,2})/(\\d{1,2})\\/(\\d{1,4})))\\s+((\\d{1,2}):(\\d{1,2})([aA][mM])?([pP][mM])?)\\s+"          // dd.MM.yy|MM-dd-yy|MM/dd/yy whitespace hh:mma|kk:mm swallow trailing spaces
    + "(?:(<DIR>)|([0-9]+))\\s+"    // <DIR> or ddddd swallow trailing spaces
    + "(\\S.*)"                     // First non-space followed by rest of line (name)
)

/**
 * Returns true if a given line might be a DOS-style listing.
 *
 * - Example: `12-05-96  05:03PM       <DIR>          myDir`
 */
export function testLine(line: string): boolean {
    return /^\d{2}/.test(line) && RE_LINE.test(line)
}

/**
 * Parse a single line of a DOS-style directory listing.
 */
export function parseLine(line: string): FileInfo | undefined {
    const groups = line.match(RE_LINE)
    if (groups === null) {
        return undefined
    }
    const name = groups[18]
    if (name === "." || name === "..") { // Ignore parent directory links
        return undefined
    }
    const file = new FileInfo(name)
    const fileType = groups[16]
    if (fileType === "<DIR>") {
        file.type = FileType.Directory
        file.size = 0
    }
    else {
        file.type = FileType.File
        file.size = parseInt(groups[17], 10)
    }
    file.rawModifiedAt = groups[1] + " " + groups[11]
    const month = groups[3] || groups[5] || groups[8]
    const day = groups[2] || groups[6] || groups[9]
    const year = groups[4] || groups[7] || groups[10]
    let hours = groups[12]
    const minutes = groups[13]
    if(groups[15]) {
        hours = parseInt(hours, 10) + 12 + ""
    }
    file.modifiedAt = new Date(month + "-" + day + "-" + year + " " + hours + ":" + minutes)
    return file
}

export function transformList(files: FileInfo[]): FileInfo[] {
    return files
}