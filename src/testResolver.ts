import { count } from 'console';
import { get } from 'http';
import * as vscode from 'vscode';



export function getWorkspaceTestPatterns() {
    if (!vscode.workspace.workspaceFolders) {
        return [];
    }

    return vscode.workspace.workspaceFolders.map(workspaceFolder => ({
        workspaceFolder,
        pattern: new vscode.RelativePattern(workspaceFolder, '**/*_test.go'),
    }));
}

export async function findInitialFiles(controller: vscode.TestController, pattern: vscode.GlobPattern) {

    const startFindFilesTime = Date.now();
    const files = await vscode.workspace.findFiles(pattern);
    const endFindFilesTime = Date.now();
    console.log(`Time elapsed for findFiles: ${endFindFilesTime - startFindFilesTime} ms`);

    await Promise.all(files.map(file => addTestFile(controller, file)));
    const endAddTestFileTime = Date.now();
    const addTestFileTime = endAddTestFileTime - endFindFilesTime;
    const avg = files.length > 0 ? (addTestFileTime / files.length).toFixed(2) : addTestFileTime;
    console.log(`Time elapsed for addTestFile (count ${files.length}): ${addTestFileTime}ms (avg: ${avg} ms/file)`);
}

export async function addTestFile(controller: vscode.TestController, uri: vscode.Uri) {
    const testFileItem = await processTestFile(controller, uri);
    if (testFileItem) {
        controller.items.add(testFileItem);
    }
}

export async function processTestFile(controller: vscode.TestController, uri: vscode.Uri): Promise<vscode.TestItem | undefined> {

    if (!uri.path.endsWith('_test.go')) {
        return;
    }

    // Create the test item for the file
    const testFileItem = controller.createTestItem(uri.toString(), uri.path.split('/').pop()!, uri);

    const docSymbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>('vscode.executeDocumentSymbolProvider', uri);

    for (const sym of docSymbols || []) {

        if (sym.kind === vscode.SymbolKind.Function && sym.name.startsWith('Test')) {

            // create test item for the test function
            const testFuncItem = controller.createTestItem(
                `${uri.toString()}::${sym.name}`,
                sym.name,
                uri);
            testFuncItem.range = sym.location.range;
            testFileItem.children.add(testFuncItem);
            testFileItem.canResolveChildren = true;

            const line = await getLocationLine(sym.location);
            let testingTReferences = await getTestingTReferences(sym.location.uri, line);

            for (const testingTRef of testingTReferences) {
                // passing the parent test name as in the end we need to know the full test name to run it 
                // e.g. ❯ go test -run "^TestXxx$/^my test case$/^my nested test case$"
                processTestingTReference(controller, testingTRef, testFuncItem);
            }
        }
    }

    return testFileItem;
}


async function getLocationLine(location: vscode.Location): Promise<vscode.TextLine> {
    const doc = await vscode.workspace.openTextDocument(location.uri);
    return doc.lineAt(location.range.start.line);
}

async function processTestingTReference(
    controller: vscode.TestController,
    testingTRef: vscode.Location,
    parentTest?: vscode.TestItem): Promise<vscode.TestItem[] | undefined> {

    const line = await getLocationLine(testingTRef);

    const testCaseItem = processRunLine(controller, testingTRef.uri, line, parentTest);
    return testCaseItem;
}

async function getTestingTReferences(uri: vscode.Uri, line: vscode.TextLine): Promise<vscode.Location[]> {
    // get references to testing.T parameter
    // this could either be from a function declaration (e.g. func TestXxx(t *testing.T){...}) 
    // or from a test case (e.g. t.Run("my test case", func(t2 *testing.T) {...})

    // Match any function with a testing.T parameter: func ...(t *testing.T)
    const testingTMatch = line.text.match(/\(\s*(\w+)\s+\*testing\.T\s*\)/);
    if (testingTMatch) {
        // const tParamName = testingTMatch[1];
        const tParamIndex = testingTMatch.index;

        if (tParamIndex !== undefined && tParamIndex !== -1) {
            const tParamPosition = new vscode.Position(line.lineNumber, tParamIndex + 1);

            const references = await vscode.commands.executeCommand<vscode.Location[]>(
                'vscode.executeReferenceProvider',
                uri,
                tParamPosition
            );

            // Remove the first reference (the declaration itself)
            return references?.slice(1) || [];
        }
    }

    return [];
}

async function processRunLine(
    controller: vscode.TestController,
    uri: vscode.Uri,
    line: vscode.TextLine,
    parentTest?: vscode.TestItem): Promise<vscode.TestItem[] | undefined> {

    // Extract the test name (first argument to .Run())
    const runMatch = line.text.match(/\.Run\(\s*([^,]+),/);
    if (!runMatch) {
        return;
    }

    const testNameArg = runMatch[1].trim();
    const tReferences = await getTestingTReferences(uri, line);

    type testData = {
        name: string,
        range: vscode.Range
    }

    let testsData: testData[] = [];

    // Check if it's a string literal (starts and ends with quotes)
    const isStringLiteral = /^["'`].*["'`]$/.test(testNameArg);

    if (isStringLiteral) {
        // this is a normal test case

        //trim quotes from testNameArg and add to parentsNames
        const testName = testNameArg.slice(1, -1);
        const testRange = await expandSelection(uri, line.range.end, { num: 1 });
        testsData = [{ name: testName, range: testRange || line.range }];

    } else {
        // It's probably a table test - get references for the variable

        // Find the position of the variable in the line
        const varIndex = line.text.indexOf(testNameArg, runMatch.index);
        if (varIndex !== -1) {
            const endOfVarName = new vscode.Position(
                line.lineNumber,
                varIndex + testNameArg.length
            );

            const fieldNameRange = await expandSelection(uri, endOfVarName, { num: 0 });
            const fieldName = await getStringAt(uri, fieldNameRange);
            if (!fieldName) {
                return;
            }

            // Get references for the variable
            const varReferences = await vscode.commands.executeCommand<vscode.Location[]>(
                'vscode.executeReferenceProvider',
                uri,
                endOfVarName
            );

            // Check each reference to find string literals
            for (const varRef of varReferences || []) {

                let varLine = await getLocationLine(varRef);

                const fieldIndex = varLine.text.indexOf(`${fieldName}:`);
                if (fieldIndex === -1) {
                    continue;
                }

                const fieldValueRange = await expandSelection(uri,
                    new vscode.Position(varLine.lineNumber, fieldIndex + fieldName.length + 1), { num: 0 });
                let fieldValue = await getStringAt(uri, fieldValueRange);
                fieldValue = fieldValue?.slice(fieldName.length + 1).trim();

                if (!fieldValue) {
                    continue;
                }

                // field value could also be a concatenation of string literals and variables, 
                // but it's not trivial to handle, so we're ignoring that for now.
                // We can discover them during execution though by parsing the output.

                // Look for string literals in the line (e.g., assignments or struct fields)
                const stringLiteralMatch = fieldValue.match(/^["'`]([^"'`]+)["'`]$/);
                if (stringLiteralMatch) {
                    const tableTestCase = stringLiteralMatch[1];

                    //calculate range of the table test by expanding selection at the position of the string literal
                    const expRange = await expandSelection(uri, varRef.range.start, { startChar: '{' });

                    testsData.push({ name: tableTestCase, range: expRange || varLine.range });
                }
            }
        }
    }


    const testCaseItems: vscode.TestItem[] = [];
    const countByTestName: { [key: string]: number } = {}; // to handle duplicate test names

    for (const testData of testsData) {
        // only create test case if within parent test range (if parent test is defined)
        // this handles table tests with nested table tests
        if (parentTest && !parentTest.range?.contains(testData.range.start)) {
            continue;
        }

        // handle duplicate test names by appending a counter
        countByTestName[testData.name] = (countByTestName[testData.name] || 0) + 1;
        if (countByTestName[testData.name] > 1) {
            const dupSuffix = String(countByTestName[testData.name] - 1).padStart(2, '0');
            testData.name = `${testData.name}#${dupSuffix}`;
        }

        let testItemId = getTestItemId(testData.name, parentTest);


        const testItem = controller.createTestItem(testItemId, testData.name, uri);
        testItem.range = testData.range;
        testCaseItems.push(testItem);

        // add to parent if present
        if (parentTest) {
            parentTest.children.add(testItem);
            parentTest.canResolveChildren = true;
        }

        // Now process references to find nested tests
        for (const tRef of tReferences || []) {
            processTestingTReference(controller, tRef, testItem);
        }
    }

    return testCaseItems;
}

function getTestItemId(testName: string, parentTest?: vscode.TestItem): string {
    if (parentTest) {
        return `${parentTest.id}/${testName}`;
    } else {
        return testName;
    }
}



async function expandSelection(
    uri: vscode.Uri,
    position: vscode.Position,
    opts: {
        startChar?: string,
        num?: number,
    }): Promise<vscode.Range | undefined> {

    const result: vscode.SelectionRange[] | undefined = await vscode.commands.executeCommand(
        'vscode.executeSelectionRangeProvider',
        uri,
        [position]
    );

    if (!result) {
        return;
    }

    if (result.length > 1) {
        console.warn('Multiple selection ranges returned, using the first one.');
    }


    let selectionRange = result[0];
    if (opts.startChar) {
        let startChar = await getCharAt(uri, selectionRange.range.start);
        while (selectionRange.parent && startChar !== '{') {
            selectionRange = selectionRange.parent;
            startChar = await getCharAt(uri, selectionRange.range.start);
        }

        if (startChar !== '{') {
            return;
        }
    } else if (opts.num) {
        for (let i = 0; i < opts.num && selectionRange.parent !== undefined; i++) {
            selectionRange = selectionRange.parent;
        }
    }

    return selectionRange.range;
}


async function getCharAt(uri: vscode.Uri, position: vscode.Position): Promise<string | undefined> {
    return getStringAt(uri, new vscode.Range(position, position.translate(0, 1)));
}

async function getStringAt(uri: vscode.Uri, range?: vscode.Range): Promise<string | undefined> {
    if (!range) {
        return undefined;
    }
    const doc = await vscode.workspace.openTextDocument(uri);
    if (range.start.line >= doc.lineCount) {
        return undefined;
    }
    const char = doc.getText(range);
    return char;
}



async function calcConcatenatedName(
    uri: vscode.Uri,
    testNameValue: string,
    range: vscode.Range
): Promise<string> {

    // split field value by +, then build the test name by going
    // through each part and, if it's a string literal add the value
    // if it's a variable, get references recursively until we find string literals

    const parts = testNameValue.split('+').map(part => part.trim());

    let finalName = '';

    let currIndex = 0;
    for (const part of parts) {
        if (/^["'`].*["'`]$/.test(part)) {
            // string literal
            finalName += part.slice(1, -1);
            currIndex += part.length;
        } else {
            // variable - get references   
            const varIndex = testNameValue.indexOf(part, range.start.character + currIndex);
            if (varIndex === -1) {
                console.error(`Variable ${part} not found in test name value: ${testNameValue}`);
            }

            const references = await vscode.commands.executeCommand<vscode.Location[]>(
                'vscode.executeReferenceProvider',
                uri,
                new vscode.Position(range.start.line, range.start.character + varIndex)
            );




        }
    }

    return finalName;
}

async function resolveVarReferenceToStringLiteral(uri: vscode.Uri, position: vscode.Position): Promise<string | undefined> {
    const references = await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeReferenceProvider',
        uri,
        position
    );

    for (const ref of references || []) {

        // we're only interested in definitions like 
        // name := "literal"
        // const name = "literal"
        // var name string = "literal"

        const line = await getLocationLine(ref);

        const stringLiteralMatch = line.text.match(/["'`]([^"'`]+)["'`]/);
        if (stringLiteralMatch) {
            return stringLiteralMatch[1];
        }


    }

}
