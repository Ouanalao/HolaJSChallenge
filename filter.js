/* 
 * 
 *  Версия с простейшим выборочным кэшированием: все адреса кэшируются только
 *  после второго появления.
 *    
 *      */

"use strict";
module.exports = function filter(m, r) {
    var defBuf = new Buffer(r.length);
    defBuf.fill(0);
    var counter = 0;
    var fromRoot = new N();
    var toRoot = new N();
    for (var i = 0; i < r.length; i++) {
        if (r[i].from != null) {
            parsePattern(r[i].from, fromRoot, i);
        } else {
            defBuf[i] = 1;
        }
        if (r[i].to != null) {
            parsePattern(r[i].to, toRoot, i);
        } else {
            defBuf[i] += 2;
            if (defBuf[i] == 3)
                counter++;
        }
    }

    var keys = Object.keys(m);
    var ra = new Buffer(r.length); // в этом буфере, служащем для агрегации результатов проверки соответствия письма правилам,
    // каждый i-ый байт соответствует i-му правилу. Если этот байт = 0, то ни from, ни to не соответствуют правилу,
    // если байт = 1, то from соответствует правилу, а to нет, если байт = 2, то наоборот, если байт = 3, то письмо полностью соответствует правилу
    var context = {counter: counter, flag: 0, toc: 0, frc: 0, result: ra};
    var tc = new Map(); // кэш to
    var fc = new Map(); // кэш from
    for (var i = 0; i < keys.length; i++) {
        context.counter = counter; // счетчик полностью подошедших правил - используется потом для аллокации массива-результата
        var t_entry = tc.get(m[keys[i]].to);
        if (t_entry != null) { // этот адрес мы видим не в первый раз - надо начинать использовать кэш! (При второй встрече - кэшируем, начиная
            // с третьего - берем из кэша)
            context.flag = 1;
        } else {
            t_entry = new cacheEntry(); // сохраним себе заметку, что этот адрес мы уже 1 раз видели, но пока не кэшируем результаты проверки правил
            tc.set(m[keys[i]].to, t_entry);
            context.flag = 0;
        }

        if (context.flag == 1) {
            if (t_entry.buf != null) { // у нас уже всё есть в кэше!
                t_entry.buf.copy(ra); // вместо проверки to-адреса загружаем в буфер результаты такой проверки, закэшированные раньше
                context.counter = t_entry.counter; // ну и счетчик полностью подошедших правил обновляем
            } else {
                defBuf.copy(ra); // иначе загружаем "стартовое состояние буфера", в котором уже учтены тривиальные правила, которые подходят любым
                // from и/или to адресам (оно генерируется выше, одновременно с добавлением всех паттернов в дерево)
                nl(context, m[keys[i]].to, 0, null, toRoot.sc, toRoot.ac); // проверяем to-адрес
                t_entry.buf = new Buffer(r.length);
                t_entry.counter = context.counter; // кэшируем состояние счетчика подошедших правил после проверки to-адреса
                ra.copy(t_entry.buf); // кэшируем результаты проверки
            }
        } else {
            defBuf.copy(ra);
            nl(context, m[keys[i]].to, 0, null, toRoot.sc, toRoot.ac); // проверяем, но пока не кэшируем результаты проверки - вдруг этот адрес
            // у нас только 1 раз и встречается?
        }


        var f_entry = fc.get(m[keys[i]].from); // аналогично и для from-адресов: первый раз ничего не кэшируем, а потом начинаем
        if (f_entry != null) {
            context.flag = 3; // заметим также, что в случае from-адресов мы НЕ кэшируем значение счетчика полностью подошедших правил,
            // т.к. оно может колебаться в зависимости от результата проведенной раньше проверки to-адреса (в случае же to-адресов мы можем
            // кэшировать значение счетчика, т.к. to-адреса проверяются первыми и значение счетчика после проверки одного и того же
            // to-адреса всегда будет одинаковым)
        } else {
            f_entry = new fEntry();
            fc.set(m[keys[i]].from, f_entry);
            context.flag = 2;
        }

        if (context.flag == 3) {

            var fnn = f_entry.a != null; // есть ли у нас есть закэшированный массив с номерами правил, подходящих проверяемому from-адресу?
            if (fnn) {
                for (var j = 0; j < f_entry.a.length; j++) {
                    if (ra[f_entry.a[j]] == 2) { // если проверка to-паттерна была успешной и в кэше есть успешный результат проверки
                        // from-паттерна, значит правило в целом подходит: обновляем счетчик и меняем значение байта в буфере
                        context.counter++;
                        ra[f_entry.a[j]] = 3;
                    }
                }
            } else {
                context.frc = 0;
                nl(context, m[keys[i]].from, 0, null, fromRoot.sc, fromRoot.ac); // проверяем from-адрес на соответствие всем правилам
                f_entry.a = new Uint32Array(context.frc); // выделяем массив с номерами подошедших правил, который будет закэширован,
                // но заполним его позже
            }

            if (!fnn && context.frc > 0) {
                if ((context.counter) > 0) {
                    m[keys[i]] = new Array(context.counter); // повторно используем объект m, в котором раньше хранились исходные данные пиьсма,
                    // а теперь будет храниться массив подошедших ему правил
                    for (var j = ra.length - 1; j >= 0; j--) {
                        switch (ra[j]) {
                            case 3:
                                m[keys[i]][--context.counter] = r[j].action; // байт равен 3? Значит правило нам подходит и мы его добавляем
                                // в итоговый результат
                            case 1:
                            {
                                if (ra[j] != defBuf[j] && defBuf[j]!=1) // проверка "defBuf[j]!=1" была пропущена в отправленном варианте :(((
                                    f_entry.a[--context.frc] = j; // заполняем кэшируемый массив номерами подходящих данному from-адресу правил
                            }
                        }
                    }
                } else {
                    m[keys[i]] = [];
                    for (var j = ra.length - 1; j >= 0; j--) {
                        switch (ra[j]) {
                            case 3:
                            case 1:
                            {
                                if (ra[j] != defBuf[j] && defBuf[j]!=1) // проверка "defBuf[j]!=1" была пропущена в отправленном варианте :(((
                                    f_entry.a[--context.frc] = j;
                            }
                        }
                    }
                }
            } else {
                if ((context.counter) > 0) {
                    m[keys[i]] = new Array(context.counter);
                    for (var j = ra.length - 1; j >= 0; j--) {
                        if (ra[j] == 3) {
                            m[keys[i]][--context.counter] = r[j].action;
                        }
                    }
                } else {
                    m[keys[i]] = [];
                }
            }


        } else {
            nl(context, m[keys[i]].from, 0, null, fromRoot.sc, fromRoot.ac);
            if ((context.counter) > 0) {
                m[keys[i]] = new Array(context.counter);
                for (var j = ra.length - 1; j >= 0; j--) {
                    if (ra[j] == 3) {
                        m[keys[i]][--context.counter] = r[j].action;
                    }
                }
            } else {
                m[keys[i]] = [];
            }
        }
        
        

    }
    
    

    return m;
}

function cacheEntry() {
    this.buf = null;
    this.counter = 0;
}

function fEntry() {
    this.a = null;
}

function addFilters(context, filters) {
    switch (context.flag) {
        case 0: // TO w/o CACHE
            {
                for (var i = filters.length - 1; i >= 0; i--) {
                    switch (context.result[filters[i]]) {
                        case 1:
                            context.counter++;
                        case 0:
                        {
                            context.result[filters[i]] += 2;
                        }
                    }
                }
            }
            break;
        case 1: // TO w/ CACHE
            {
                for (var i = filters.length - 1; i >= 0; i--) {
                    switch (context.result[filters[i]]) {
                        case 1:
                            context.counter++; // обновляем счетчик полностью подошедших правил
                        case 0:
                        {
                            context.result[filters[i]] += 2;
                            context.toc++; // обновляем счетчик правил, подошедших to-адресу
                        }
                    }
                }
            }
            break;
        case 2: // FROM w/o CACHE
            {
                for (var i = filters.length - 1; i >= 0; i--) {
                    if (context.result[filters[i]] == 2) {
                        context.counter++;
                        context.result[filters[i]] += 1;
                    }
                }
            }
            break;
        case 3: // FROM w/ CACHE
            {
                for (var i = filters.length - 1; i >= 0; i--) {
                    switch (context.result[filters[i]]) {
                        case 2:
                            context.counter++;
                        case 0:
                        {
                            context.result[filters[i]] += 1;
                            context.frc++; // обновляем счетчик правил, подошедших from-адресу
                        }
                    }
                }
            }
    }
}



function nl(context, str, offset, filters, sc, ac) {
    if ((filters != null) && (str.length == offset)) { // если строка закончилась, пытаемся добавить соответсвующие данной ноде правила
        addFilters(context, filters);
    } else {
        var b = str.length - offset;
        if (b < sc.length) {
            if ((sc[b] != null) && (sc[b][0] != null)) { // если после этой ноды до конца паттерна есть только "???", и проверяемая строка подходит
                addFilters(context, sc[b][0].filters);
            }
        } else {
            b = sc.length;
        }
        for (var min = 0; min < b; min++) { // обрабатываем случаи "продолжение" и "?продолжение" (знаков вопроса м.б. и больше)
            if (sc[min] != null) {
                var next = sc[min][str.charCodeAt(offset + min) - 31]; // пытаемся прыгнуть на следующую ноду, если она существует
                if (next != null) {
                    nl(context, str, offset + min + 1, next.filters, next.sc, next.ac);
                }
            }
        }
        b = Math.min(ac.length, str.length - offset); // обрабатываем случай "*продолжение" (звездочек и знаков вопроса может быть больше)
        for (min = 0; min < b; min++) {
            if (ac[min] != null) {
                for (var i = offset + min; i < str.length; i++) {
                    var next = ac[min][str.charCodeAt(i) - 31];
                    if (next != null && next.c <= str.length - i + min) {
                        nl(context, str, i + 1, next.filters, next.sc, next.ac);
                    }
                }
            }
        }
    }
    var boundary = Math.min(ac.length, str.length - offset + 1); // обрабатываем случай, когда после этой ноды до конца паттерна есть только * и ?
    for (var min = 0; min < boundary; min++) {
        if ((ac[min] != null) && (ac[min][0] != null)) {
            addFilters(context, ac[min][0].filters);
        }
    }
}

function N() {
    this.c = -1; // минимальное количество символов до конца проверяемой строки, при котором есть смысл продолжать проверку
    this.sc = []; // sc[x][y] - ссылка на node, соответствующий символу с кодом y+31 (либо концу строки в паттерне,
    // заканчивающемся знаками вопроса, если y == 0), перед которым пропущено x символов.
    // Например, в паттерне b??a у ноды, соответствующей первому символу (b) будет потомок sc[2][66], соответствующий последней букве (а)
    // В паттерне ba у ноды (b) будет потомок sc[0][66].
    // В паттерне ba??? у ноды (a) будет потомок sc[3][0]
    this.ac = []; // аналогично предыдущему массиву, только для случаев, когда следующему символу предшествует еще и asterisk (*),
    // поэтому в ac[x][y] x означает МИНИМАЛЬНОЕ количество символов, которые должны быть пропущены
    // Например, в паттерне b??*a у ноды (b) будет потомок ac[2][66]
    // В паттерне b*a у ноды (b) будет потомок ac[0][66].
    // В паттерне ba?*?*? у ноды (a) будет потомок ac[3][0]
    this.filters = []; // список фильтров (правил), которым соответствует проверяемая строка, если она закончилась на данной ноде.
}

function addNode(parent, char, min, asterisk, c) {

    var set = (asterisk ? parent.ac : parent.sc); // будем добавлять новую ноду в массив sc или ac?
    var node;
    if (min >= set.length) { // ой, массив пока маленький, надо расширить

        var i = min + 1;
        var newArray = new Array(i--); // создаем новый массив, чтобы не было пропусков и перехода в медленный dictionary mode
        while (i--) {
            newArray[i] = set[i]; // переносим элементы из старого массива
        }
        if (asterisk) {
            parent.ac = newArray;
            set = newArray;
        } else {
            parent.sc = newArray;
            set = newArray;
        }
    }

    if (set[min] == null) {
        set[min] = new Array(97); // у нас пока не было массива нод, требующих пропуска min символов, поэтому мы его создаем.
        // 97 - это диапазон допустимых символов (коды 32..127 -> элементы массива 1..96) + нулевой элемент для обработки ситуаций,
        // когда в конце паттерна * и/или ?, а не нормальный символ
    }

    node = set[min][(char == '') ? 0 : char.charCodeAt(0) - 31];
    if (node == null) { // ноды, соответствующей символу, пока нет, поэтому мы ее создаем (если уже есть, то мы просто возвращаем ее)
        node = new N();
        set[min][(char == '') ? 0 : char.charCodeAt(0) - 31] = node;
    }
    if (node.c == -1 || node.c > c) { // обновляем, если необходимо, минимальное количество оставшихся в проверяемой строке символов, необходимое
        // для продолжения проверки - это для избегания ситуаций, когда, например, мы проверяем строку username@website.com на соответствие
        // паттерну "*loooooooooooooongdomain.com" и ищем первый после звездочки символ "l" аж до самого конца проверяемой строки, хотя
        // можно намного раньше определить, что loooooooooooooongdomain.com там уже просто не поместится.
        node.c = c;
    }

    return node;
}


function parsePattern(pstr, parent, rule) { // ну, тут всё просто

    var segments = pstr.split("*");
    var min = 0;
    var asterisk = false;
    var c = pstr.length - segments.length + 1;
    for (var i = 0; i < segments.length; i++) {
        asterisk = i > 0;
        for (var j = 0; j < segments[i].length; j++) {
            switch (segments[i][j]) {
                case "?":
                    {
                        min++;
                    }
                    break;
                default:
                {
                    parent = addNode(parent, segments[i][j], min, asterisk, c);
                    c -= min + 1;
                    min = 0;
                    asterisk = false;
                }
            }
        }
    }
    if (segments.length > 0 && segments[segments.length - 1] == "") {
        parent = addNode(parent, "", min, true, c);
    } else if (pstr.length > 0 && pstr.charAt(pstr.length - 1) == "?") {
        parent = addNode(parent, "", min, asterisk, c);
    }
    parent.filters.push(rule);
}
